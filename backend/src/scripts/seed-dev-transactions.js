import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

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
    console.log("Connected to database. Seeding demo transactions...");

    // 1. Insert Branch
    const branchRes = await client.query(
      `INSERT INTO branches (branch_code, district_name, region)
       VALUES ('BR-DEMO', 'London City', 'UK-EAST')
       ON CONFLICT (branch_code) DO UPDATE SET district_name = EXCLUDED.district_name
       RETURNING branch_id`
    );
    const branchId = branchRes.rows[0].branch_id;

    // 2. Insert Client
    const clientRes = await client.query(
      `INSERT INTO clients (external_ref, full_name, branch_id)
       VALUES ('CLI-DEMO', 'Acme Corp Ltd', $1)
       ON CONFLICT (external_ref) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING client_id`,
      [branchId]
    );
    const clientId = clientRes.rows[0].client_id;

    // 3. Insert Account
    const accountRes = await client.query(
      `INSERT INTO accounts (client_id, account_number, account_type, currency, external_ref)
       VALUES ($1, '12345678', 'CURRENT', 'GBP', 'ACC-TEST')
       ON CONFLICT (external_ref) DO UPDATE SET account_number = EXCLUDED.account_number
       RETURNING account_id`,
      [clientId]
    );
    const accountId = accountRes.rows[0].account_id;

    // Clean up old transactions to avoid duplicate runs bloating
    await client.query("TRUNCATE ledger_transactions, external_statement_lines, import_batches, reconciliation_exceptions CASCADE");

    // 4. Create an internal Import Batch
    const batchRes = await client.query(
      `INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, started_at, completed_at, row_count)
       VALUES (1, 'internal_ledger.csv', 'dummy-hash-ledger', (SELECT user_id FROM users LIMIT 1), 'COMPLETED', now(), now(), 4)
       RETURNING batch_id`
    );
    const batchId = batchRes.rows[0].batch_id;

    // 5. Insert Ledger Transactions
    const ledgerTxns = [
      { ref: "LDG-TXN-1", type: "CREDIT", amount: 100.00, date: "2026-07-18" },
      { ref: "LDG-TXN-2", type: "DEBIT",  amount: 50.00,  date: "2026-07-18" },
      { ref: "LDG-TXN-3", type: "CREDIT", amount: 150.00, date: "2026-07-18" }, // Will be missing in statement
      { ref: "LDG-TXN-4", type: "CREDIT", amount: 200.00, date: "2026-07-18" }, // Will have rounding difference
    ];

    for (const t of ledgerTxns) {
      await client.query(
        `INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date, batch_id)
         VALUES ($1, $2, $3, $4, 'GBP', $5, $6)`,
        [accountId, t.ref, t.type, t.amount, t.date, batchId]
      );
    }

    console.log("\nSUCCESS: Seeding complete!");
    console.log("--------------------------------------------------------------------------------");
    console.log("Copy the CSV block below, save it as 'statement.csv', and upload it in the UI:");
    console.log("--------------------------------------------------------------------------------");
    console.log(`external_ref,account_ref,amount,currency,value_date,settlement_date
EXT-TXN-1,ACC-TEST,100.00,GBP,2026-07-18,2026-07-18
EXT-TXN-2,ACC-TEST,-50.00,GBP,2026-07-18,2026-07-18
EXT-TXN-4,ACC-TEST,200.05,GBP,2026-07-18,2026-07-18
EXT-TXN-5,ACC-TEST,75.00,GBP,2026-07-18,2026-07-18`);
    console.log("--------------------------------------------------------------------------------\n");

  } catch (err) {
    console.error("Failed to seed demo transactions:", err);
  } finally {
    await client.end();
  }
}

run();
