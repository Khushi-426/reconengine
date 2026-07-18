import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../../db/seed/data");

async function run() {
  const client = new pg.Client({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: "postgres",
    password: process.env.DB_PASSWORD || "change_me_in_env",
    database: process.env.DB_NAME || "reconengine",
  });

  try {
    await client.connect();
    console.log("Connected to database. Parsing CSV files from seed/data...");

    // Clean up transaction tables first to make it a fresh run
    await client.query("TRUNCATE ledger_transactions, external_statement_lines, import_batches, reconciliation_exceptions, accounts, clients, branches CASCADE");

    // 1. Seed branches from district.csv
    console.log("Seeding branches from district.csv...");
    const districtContent = fs.readFileSync(path.join(dataDir, "district.csv"), "utf8");
    const districts = parse(districtContent, { delimiter: ";", columns: true, skip_empty_lines: true });

    const branchMap = new Map(); // district_id -> branch_id
    for (const d of districts) {
      const districtId = parseInt(d.A1, 10);
      const districtName = d.A2.replace(/"/g, "");
      const region = d.A3.replace(/"/g, "");
      
      const res = await client.query(
        `INSERT INTO branches (branch_code, district_name, region)
         VALUES ($1, $2, $3) RETURNING branch_id`,
        [`BR-${districtId}`, districtName, region]
      );
      branchMap.set(districtId, res.rows[0].branch_id);
    }
    console.log(`Seeded ${districts.length} branches.`);

    // 2. Seed clients from client.csv
    console.log("Seeding clients from client.csv...");
    const clientContent = fs.readFileSync(path.join(dataDir, "client.csv"), "utf8");
    const clientRecords = parse(clientContent, { delimiter: ";", columns: true, skip_empty_lines: true });

    const clientMap = new Map(); // client_id -> client_id in DB
    const clientsToSeed = clientRecords.slice(0, 500);
    for (const c of clientsToSeed) {
      const clientId = parseInt(c.client_id, 10);
      const districtId = parseInt(c.district_id, 10);
      const dbBranchId = branchMap.get(districtId);
      
      const res = await client.query(
        `INSERT INTO clients (external_ref, full_name, branch_id)
         VALUES ($1, $2, $3) RETURNING client_id`,
        [`CLI-${clientId}`, `Client ${clientId}`, dbBranchId]
      );
      clientMap.set(clientId, res.rows[0].client_id);
    }
    console.log(`Seeded ${clientsToSeed.length} clients.`);

    // 3. Seed accounts from account.csv
    console.log("Seeding accounts from account.csv...");
    const accountContent = fs.readFileSync(path.join(dataDir, "account.csv"), "utf8");
    const accountRecords = parse(accountContent, { delimiter: ";", columns: true, skip_empty_lines: true });

    const accountMap = new Map(); // account_id -> account_id in DB
    const accountRefMap = new Map(); // account_id -> external_ref
    const accountsToSeed = accountRecords.filter(a => clientMap.has(parseInt(a.account_id, 10))).slice(0, 100);
    for (const a of accountsToSeed) {
      const accId = parseInt(a.account_id, 10);
      const dbClientId = clientMap.get(accId);
      const extRef = `ACC-${accId}`;
      const districtId = parseInt(a.district_id, 10);
      const dbBranchId = branchMap.get(districtId) || branchMap.values().next().value;
      
      const res = await client.query(
        `INSERT INTO accounts (client_id, branch_id, account_type, currency, external_ref)
         VALUES ($1, $2, $3, $4, $5) RETURNING account_id`,
        [dbClientId, dbBranchId, 'CURRENT', 'GBP', extRef]
      );
      accountMap.set(accId, res.rows[0].account_id);
      accountRefMap.set(accId, extRef);
    }
    console.log(`Seeded ${accountMap.size} accounts.`);

    // 4. Seed ledger transactions from trans.csv
    console.log("Seeding ledger transactions from trans.csv (limit 1000)...");
    const transContent = fs.readFileSync(path.join(dataDir, "trans.csv"), "utf8");
    const transRecords = parse(transContent, { delimiter: ";", columns: true, skip_empty_lines: true });

    const transToSeed = transRecords.filter(t => accountMap.has(parseInt(t.account_id, 10))).slice(0, 1000);
    
    const batchRes = await client.query(
      `INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, started_at, completed_at, row_count)
       VALUES (1, 'internal_trans_seed.csv', 'hash-ledger-seed', (SELECT user_id FROM users LIMIT 1), 'COMPLETED', now(), now(), $1)
       RETURNING batch_id`,
      [transToSeed.length]
    );
    const batchId = batchRes.rows[0].batch_id;

    const formatBerkaDate = (yymmdd) => {
      const s = String(yymmdd).padStart(6, "0");
      const yy = parseInt(s.slice(0, 2), 10);
      const mm = parseInt(s.slice(2, 4), 10);
      const dd = parseInt(s.slice(4, 6), 10);
      const year = 1900 + yy;
      return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    };

    const insertedTxns = [];
    for (const t of transToSeed) {
      const accId = parseInt(t.account_id, 10);
      const dbAccId = accountMap.get(accId);
      const amount = parseFloat(t.amount);
      const txnType = t.type === "PRIJEM" ? "CREDIT" : "DEBIT";
      const txnRef = `LDG-${t.trans_id}`;
      const valueDate = formatBerkaDate(t.date);

      await client.query(
        `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date, batch_id)
         VALUES ($1, $2, $3, $4, 'GBP', $5, $6)`,
        [dbAccId, txnRef, txnType, amount, valueDate, batchId]
      );
      insertedTxns.push({
        accountRef: accountRefMap.get(accId),
        amount: txnType === "DEBIT" ? -amount : amount,
        valueDate
      });
    }
    console.log(`Seeded ${insertedTxns.length} ledger transactions.`);

    // 5. Generate a matching external statement CSV file
    console.log("Generating external statement CSV data...");
    const csvLines = ["external_ref,account_ref,amount,currency,value_date,settlement_date"];
    
    let extIndex = 1;
    for (const item of insertedTxns) {
      const rand = Math.random();
      if (rand < 0.85) {
        csvLines.push(`EXT-${extIndex++},${item.accountRef},${Math.abs(item.amount).toFixed(2)},GBP,${item.valueDate},${item.valueDate}`);
      } else if (rand < 0.93) {
        const delta = (Math.random() - 0.5) * 0.04;
        const deltaAmount = Math.abs(item.amount) + delta;
        csvLines.push(`EXT-${extIndex++},${item.accountRef},${deltaAmount.toFixed(2)},GBP,${item.valueDate},${item.valueDate}`);
      } else {
        continue;
      }
    }

    if (insertedTxns.length > 0) {
      csvLines.push(`EXT-${extIndex++},${insertedTxns[0].accountRef},125.50,GBP,${insertedTxns[0].valueDate},${insertedTxns[0].valueDate}`);
    }

    const outputCsvPath = path.join(dataDir, "external_statement_to_upload.csv");
    fs.writeFileSync(outputCsvPath, csvLines.join("\n"), "utf8");
    
    console.log("\n--------------------------------------------------------------------------------");
    console.log(`SUCCESS: Created external statement CSV file at:`);
    console.log(`c:/Users/parag/Downloads/reconengine/reconengine/db/seed/data/external_statement_to_upload.csv`);
    console.log("--------------------------------------------------------------------------------");
    console.log("Upload this file in the 'Ingest Statement' tab in the web application!");
    console.log("--------------------------------------------------------------------------------\n");

  } catch (err) {
    console.error("Failed to seed from CSV:", err);
  } finally {
    await client.end();
  }
}

run();
