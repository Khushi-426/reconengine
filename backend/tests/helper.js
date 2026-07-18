import pg from "pg";
import bcrypt from "bcrypt";

const testDbConfig = {
  host: "localhost",
  port: 5433,
  user: "postgres", // Connect as postgres superuser to clean/seed without RLS issues
  password: "change_me_in_env",
  database: "reconengine_test",
};

export const testPool = new pg.Pool(testDbConfig);

export async function cleanDb() {
  const tables = [
    "report_snapshots",
    "daily_close_signoffs",
    "sla_definitions",
    "audit_log",
    "reconciliation_exceptions",
    "match_group_external_lines",
    "match_group_ledger_lines",
    "match_groups",
    "reconciliation_runs",
    "external_statement_lines",
    "import_batches",
    "ledger_transactions",
    "accounts",
    "clients",
    "branches",
    "users",
  ];
  await testPool.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
}

export async function createTestUser({ email, password, fullName, roleId }) {
  const hash = await bcrypt.hash(password, 10);
  const result = await testPool.query(
    `INSERT INTO users (email, password_hash, full_name, role_id)
     VALUES ($1, $2, $3, $4)
     RETURNING user_id`,
    [email, hash, fullName, roleId]
  );
  return result.rows[0].user_id;
}

export async function seedFixture(userId) {
  // 1. Insert branch
  const branchRes = await testPool.query(
    `INSERT INTO branches (branch_code, district_name, region)
     VALUES ('BR-TEST', 'District Test', 'UK-TEST') RETURNING branch_id`
  );
  const branchId = branchRes.rows[0].branch_id;

  // 2. Insert client
  const clientRes = await testPool.query(
    `INSERT INTO clients (external_ref, full_name, branch_id)
     VALUES ('CLI-TEST', 'Client Test', $1) RETURNING client_id`,
    [branchId]
  );
  const clientId = clientRes.rows[0].client_id;

  // 3. Insert account
  const accountRes = await testPool.query(
    `INSERT INTO accounts (external_ref, client_id, branch_id, account_type, currency)
     VALUES ('ACC-TEST', $1, $2, 'CURRENT', 'GBP') RETURNING account_id`,
    [clientId, branchId]
  );
  const accountId = accountRes.rows[0].account_id;

  // 4. Insert import batches
  const batchRes = await testPool.query(
    `INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, row_count)
     VALUES (1, 'internal.csv', 'hash-1', $1, 'COMPLETED', 10),
            (2, 'external.csv', 'hash-2', $1, 'COMPLETED', 10)
     RETURNING batch_id`,
    [userId]
  );
  const internalBatchId = batchRes.rows[0].batch_id;
  const externalBatchId = batchRes.rows[1].batch_id;

  return { branchId, clientId, accountId, internalBatchId, externalBatchId };
}
