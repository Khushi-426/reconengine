import { withTransaction } from "../../config/db.js";
import { retrieveEvidence, EVIDENCE_RETRIEVAL } from "./evidenceRetrievalAgent.js";
import { analyzeFinancials, FINANCIAL_ANALYSIS } from "./financialAnalysisAgent.js";
import { investigateDeterministically, INVESTIGATION } from "./investigationAgent.js";
import { verifyAndReport, VERIFICATION_REPORTING } from "./verificationReportingAgent.js";
import { config } from "../../config/env.js";

const executionOrder = [EVIDENCE_RETRIEVAL, FINANCIAL_ANALYSIS, INVESTIGATION, VERIFICATION_REPORTING];

async function assertOwnership(client, { jobId, workerId, attempt }) {
  const owner = await client.query(`SELECT job_id FROM background_jobs WHERE job_id=$1 AND worker_owner=$2 AND attempts=$3 AND status='RUNNING' FOR UPDATE`, [jobId, workerId, attempt]);
  if (!owner.rowCount) throw new Error("Investigation attempt lost its worker fence");
}

async function executeStage({ investigationId, agentName, inputs, fn, userId, userRole, fence }) {
  await withTransaction(async (client) => {
    await assertOwnership(client, fence);
    await client.query(`INSERT INTO investigation_agent_executions (investigation_id,agent_name,attempt,status,input_references)
      VALUES ($1,$2,$3,'RUNNING',$4::jsonb) ON CONFLICT (investigation_id,agent_name,attempt) DO UPDATE
      SET status='RUNNING',input_references=EXCLUDED.input_references,output=NULL,error_details=NULL,started_at=now(),completed_at=NULL`,
    [investigationId, agentName, fence.attempt, JSON.stringify(inputs)]);
    await client.query(`INSERT INTO investigation_audit_history(investigation_id,event_type,details) VALUES ($1,'AGENT_STARTED',$2::jsonb)`, [investigationId, JSON.stringify({ agentName, attempt: fence.attempt })]);
  }, { userId, userRole });
  try {
    const output = await fn();
    await withTransaction(async (client) => {
      await assertOwnership(client, fence);
      await client.query(`UPDATE investigation_agent_executions SET status='COMPLETED',output=$4::jsonb,completed_at=now()
        WHERE investigation_id=$1 AND agent_name=$2 AND attempt=$3`, [investigationId, agentName, fence.attempt, JSON.stringify(output)]);
      if (agentName === EVIDENCE_RETRIEVAL) {
        for (const [type, id, metadata] of output.evidenceRecords) {
          await client.query(`INSERT INTO investigation_evidence(investigation_id,evidence_type,source_record_id,metadata)
            VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`, [investigationId, type, id, JSON.stringify(metadata)]);
        }
      }
      await client.query(`INSERT INTO investigation_audit_history(investigation_id,event_type,details) VALUES ($1,'AGENT_COMPLETED',$2::jsonb)`, [investigationId, JSON.stringify({ agentName })]);
    }, { userId, userRole });
    return output;
  } catch (error) {
    await withTransaction(async (client) => {
      await assertOwnership(client, fence);
      await client.query(`UPDATE investigation_agent_executions SET status='FAILED',error_details=$4,completed_at=now()
        WHERE investigation_id=$1 AND agent_name=$2 AND attempt=$3`, [investigationId, agentName, fence.attempt, error.message]);
      await client.query(`INSERT INTO investigation_audit_history(investigation_id,event_type,details) VALUES ($1,'AGENT_FAILED',$2::jsonb)`, [investigationId, JSON.stringify({ agentName, error: error.message })]);
    }, { userId, userRole });
    throw error;
  }
}

function evidenceRecords(output) {
  const records = [["EXCEPTION", output.exception.id, output.exception], ...(output.run ? [["RECONCILIATION_RUN", output.run.id, output.run]] : [])];
  if (output.account?.id) records.push(["ACCOUNT", output.account.id, output.account]);
  if (output.ledger) records.push(["LEDGER_TRANSACTION", output.ledger.id, output.ledger]);
  if (output.external) records.push(["EXTERNAL_RECORD", output.external.id, output.external]);
  for (const c of output.duplicateCandidates) records.push([c.type, c.id, c]);
  return { ...output, evidenceRecords: records };
}

export async function runInvestigationJob({ investigationId, exceptionId, userId, userRole, jobId, workerId, attempt }) {
  const fence = { jobId, workerId, attempt };
  await withTransaction(async (client) => {
    await assertOwnership(client, fence);
    await client.query(`UPDATE investigations SET status='RUNNING',started_at=COALESCE(started_at,now()) WHERE investigation_id=$1`, [investigationId]);
    await client.query(`INSERT INTO investigation_audit_history(investigation_id,event_type,details) VALUES ($1,'INVESTIGATION_STARTED',$2::jsonb)`, [investigationId, JSON.stringify({ workerId, attempt })]);
  }, { userId, userRole });
  try {
    const retrieved = await executeStage({ investigationId, agentName: EVIDENCE_RETRIEVAL, inputs: [`EXCEPTION_${exceptionId}`], userId, userRole, fence,
      fn: () => withTransaction((client) => retrieveEvidence(client, { exceptionId, userId, userRole }), { userId, userRole }).then(evidenceRecords) });
    const evidence = { ...retrieved }; delete evidence.evidenceRecords;
    const analysis = await executeStage({ investigationId, agentName: FINANCIAL_ANALYSIS, inputs: evidence.evidenceIds, userId, userRole, fence, fn: async () => analyzeFinancials(evidence, config.investigation) });
    const historical = await withTransaction((client) => client.query(`SELECT investigation_id,discrepancy_category FROM investigations WHERE exception_id=$1 AND status='COMPLETED' ORDER BY completed_at DESC LIMIT 20`, [exceptionId]), { userId, userRole });
    if (historical.rowCount) {
      await withTransaction(async (client) => {
        await assertOwnership(client, fence);
        for (const item of historical.rows) {
          const sourceId = `INVESTIGATION_${item.investigation_id}`;
          evidence.evidenceIds.push(sourceId);
          await client.query(`INSERT INTO investigation_evidence(investigation_id,evidence_type,source_record_id,metadata)
            VALUES ($1,'HISTORICAL_INVESTIGATION',$2,$3::jsonb) ON CONFLICT DO NOTHING`, [investigationId, String(item.investigation_id), JSON.stringify({ evidenceId: sourceId, discrepancyCategory: item.discrepancy_category })]);
        }
      }, { userId, userRole });
    }
    const investigation = await executeStage({ investigationId, agentName: INVESTIGATION, inputs: [...evidence.evidenceIds, `CLASSIFICATION_${analysis.category}`], userId, userRole, fence, fn: async () => investigateDeterministically(evidence, analysis, historical.rows) });
    const verified = await executeStage({ investigationId, agentName: VERIFICATION_REPORTING, inputs: [...evidence.evidenceIds, `CLASSIFICATION_${analysis.category}`], userId, userRole, fence, fn: async () => verifyAndReport({ investigationId, exceptionId, evidence, analysis, investigation, rules: config.investigation }) });
    if (verified.verification.status === "FAILED") throw new Error(`Report verification failed: ${verified.verification.errors.join("; ")}`);
    const result = { investigationId: String(investigationId), exceptionId: String(exceptionId), status: "COMPLETED", discrepancyCategory: analysis.category, evidence, analysis, investigation, ...verified, executionHistory: executionOrder };
    await withTransaction(async (client) => {
      await assertOwnership(client, fence);
      await client.query(`UPDATE investigations SET status='COMPLETED',discrepancy_category=$2,result=$3::jsonb,completed_at=now() WHERE investigation_id=$1`, [investigationId, analysis.category, JSON.stringify(result)]);
      await client.query(`INSERT INTO investigation_audit_history(investigation_id,event_type,details) VALUES ($1,'REPORT_GENERATED',$2::jsonb)`, [investigationId, JSON.stringify({ verificationStatus: verified.verification.status })]);
    }, { userId, userRole });
  } catch (error) {
    await withTransaction(async (client) => {
      const owner = await client.query(`SELECT job_id FROM background_jobs WHERE job_id=$1 AND worker_owner=$2 AND attempts=$3 AND status='RUNNING' FOR UPDATE`, [jobId, workerId, attempt]);
      if (!owner.rowCount) return;
      await client.query(`INSERT INTO investigation_audit_history(investigation_id,event_type,details) VALUES ($1,'RETRY_OR_FAILURE',$2::jsonb)`, [investigationId, JSON.stringify({ attempt, error: error.message })]);
      if (attempt >= 3) await client.query(`UPDATE investigations SET status='FAILED',completed_at=now() WHERE investigation_id=$1`, [investigationId]);
      else await client.query(`UPDATE investigations SET status='QUEUED' WHERE investigation_id=$1`, [investigationId]);
    }, { userId, userRole });
    throw error;
  }
}

export async function getInvestigation(investigationId, { userId, userRole }) {
  return withTransaction(async (client) => {
    const result = await client.query(`SELECT i.*,COALESCE(json_agg(json_build_object('agentName',e.agent_name,'attempt',e.attempt,'status',e.status,'output',e.output,'error',e.error_details,'startedAt',e.started_at,'completedAt',e.completed_at) ORDER BY e.execution_id) FILTER (WHERE e.execution_id IS NOT NULL),'[]'::json) AS stages
      FROM investigations i LEFT JOIN investigation_agent_executions e USING(investigation_id)
      WHERE i.investigation_id=$1 GROUP BY i.investigation_id`, [investigationId]);
    return result.rows[0] || null;
  }, { userId, userRole });
}
