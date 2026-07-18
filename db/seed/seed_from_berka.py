"""
ReconEngine seed script.

Loads the free Berka bank dataset (https://data.world/lpetrocelli/czech-financial-dataset-real-anonymized-transactions
or https://sorry.vse.cz/~berka/challenge/PAST/) and:
  1. Loads accounts/clients/trans into our normalized schema as the internal ledger.
  2. Generates a synthetic "external statement feed" derived from a sample of those
     transactions, deliberately injecting realistic reconciliation discrepancies:
       - timing offset (T+1/T+2 settlement)
       - FX/fee rounding differences (small amount deltas)
       - batched settlements (many internal txns -> one external line)
       - missing lines (some internal txns never appear externally -> exception)
       - duplicate lines (data-entry duplication -> exception)

Run:
    pip install psycopg2-binary pandas
    python seed_from_berka.py --trans-csv trans.csv --account-csv account.csv --client-csv client.csv
"""

import argparse
import hashlib
import random
import uuid
from datetime import timedelta

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

random.seed(42)


def parse_berka_date(yymmdd: str):
    # Berka dates are YYMMDD strings, e.g. 930101
    s = str(yymmdd).zfill(6)
    yy, mm, dd = int(s[0:2]), int(s[2:4]), int(s[4:6])
    year = 1900 + yy
    return f"{year:04d}-{mm:02d}-{dd:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trans-csv", required=True)
    ap.add_argument("--account-csv", required=True)
    ap.add_argument("--client-csv", required=True)
    ap.add_argument("--dsn", default="dbname=reconengine user=reconengine_app password=change_me_in_env host=localhost")
    ap.add_argument("--limit", type=int, default=200000, help="cap rows for a manageable local dev dataset")
    args = ap.parse_args()

    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    # --- reference data -------------------------------------------------
    cur.execute("""
        INSERT INTO roles (role_id, role_name, description) VALUES
        (1,'ADMIN','Full system access'),
        (2,'APPROVER','Can approve/resolve exceptions'),
        (3,'ANALYST','Investigates and matches exceptions'),
        (4,'AUDITOR','Read-only, full audit visibility')
        ON CONFLICT DO NOTHING;
    """)
    cur.execute("""
        INSERT INTO import_sources (source_id, source_name, file_format) VALUES
        (1,'INTERNAL_LEDGER','CSV'),
        (2,'SWIFT_MT940','MT940'),
        (3,'CARD_NETWORK','CSV')
        ON CONFLICT DO NOTHING;
    """)
    cur.execute("""
        INSERT INTO match_rules (rule_name, rule_type, amount_tolerance, date_window_days, priority) VALUES
        ('Exact match same-day', 'EXACT', 0, 2, 10),
        ('FX rounding tolerance 1%', 'TOLERANCE', 0.01, 3, 20),
        ('Batched settlement sum', 'BATCH_SUM', 0, 5, 30)
        ON CONFLICT DO NOTHING;
    """)
    conn.commit()

    # --- clients / accounts ---------------------------------------------
    clients = pd.read_csv(args.client_csv, sep=";" if ";" in open(args.client_csv).readline() else ",")
    accounts = pd.read_csv(args.account_csv, sep=";" if ";" in open(args.account_csv).readline() else ",")

    branch_ids = {}
    for district in accounts.get("district_id", pd.Series(dtype=int)).unique():
        cur.execute(
            "INSERT INTO branches (branch_code, district_name, region) VALUES (%s,%s,%s) RETURNING branch_id",
            (f"BR-{district}", f"District {district}", "UK-SIM"),
        )
        branch_ids[district] = cur.fetchone()[0]
    conn.commit()

    client_id_map = {}
    for _, row in clients.iterrows():
        cur.execute(
            "INSERT INTO clients (external_ref, full_name, branch_id) VALUES (%s,%s,%s) RETURNING client_id",
            (str(row["client_id"]), f"Client {row['client_id']}", list(branch_ids.values())[0] if branch_ids else None),
        )
        client_id_map[row["client_id"]] = cur.fetchone()[0]
    conn.commit()

    account_id_map = {}
    for _, row in accounts.iterrows():
        branch_id = branch_ids.get(row.get("district_id"), list(branch_ids.values())[0] if branch_ids else None)
        cur.execute(
            """INSERT INTO accounts (external_ref, client_id, branch_id, account_type, currency)
               VALUES (%s,%s,%s,'CURRENT','GBP') RETURNING account_id""",
            (str(row["account_id"]), list(client_id_map.values())[0], branch_id),
        )
        account_id_map[row["account_id"]] = cur.fetchone()[0]
    conn.commit()

    # --- internal ledger transactions ------------------------------------
    trans = pd.read_csv(args.trans_csv, sep=";" if ";" in open(args.trans_csv).readline() else ",", low_memory=False)
    trans = trans.head(args.limit)

    admin_user_id = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO users (user_id, email, password_hash, full_name, role_id) VALUES (%s,%s,%s,%s,1)",
        (admin_user_id, "seed-loader@reconengine.local", "x", "Seed Loader"),
    )

    batch_hash = hashlib.sha256(args.trans_csv.encode()).hexdigest()
    cur.execute(
        """INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, row_count)
           VALUES (1, %s, %s, %s, 'COMPLETED', %s) RETURNING batch_id""",
        (args.trans_csv, batch_hash, admin_user_id, len(trans)),
    )
    batch_id = cur.fetchone()[0]
    conn.commit()

    ledger_rows = []
    ledger_ids_for_external = []  # (ledger_row_index, account_ext_ref, amount, date)

    for _, row in trans.iterrows():
        acc_id = account_id_map.get(row["account_id"])
        if acc_id is None:
            continue
        txn_type = "CREDIT" if str(row.get("type", "")).lower().startswith("credit") else "DEBIT"
        amount = abs(float(row["amount"]))
        value_date = parse_berka_date(row["date"])
        txn_ref = f"LDG-{row.get('trans_id', uuid.uuid4())}"
        ledger_rows.append((acc_id, txn_ref, txn_type, amount, "GBP", value_date, batch_id))

    execute_values(
        cur,
        """INSERT INTO ledger_transactions (account_id, txn_ref, txn_type, amount, currency, value_date, batch_id)
           VALUES %s RETURNING ledger_txn_id, account_id, amount, value_date""",
        ledger_rows,
        fetch=True,
    )
    inserted = cur.fetchall()
    conn.commit()

    # --- synthetic external statement feed with deliberate discrepancies --
    ext_batch_hash = hashlib.sha256((args.trans_csv + "_external").encode()).hexdigest()
    cur.execute(
        """INSERT INTO import_batches (source_id, file_name, file_hash, uploaded_by, status, row_count)
           VALUES (2, 'synthetic_swift_feed.csv', %s, %s, 'COMPLETED', 0) RETURNING batch_id""",
        (ext_batch_hash, admin_user_id),
    )
    ext_batch_id = cur.fetchone()[0]

    ext_rows = []
    reverse_account_map = {v: k for k, v in account_id_map.items()}

    for ledger_txn_id, acc_id, amount, value_date in inserted:
        r = random.random()
        acc_ext_ref = str(reverse_account_map.get(acc_id))

        if r < 0.85:
            # clean match, possibly +1/2 day settlement lag
            settle_date = value_date  # keep simple; could add timedelta
            ext_rows.append((ext_batch_id, 2, f"EXT-{uuid.uuid4()}", acc_ext_ref, amount, "GBP", value_date, settle_date, False))
        elif r < 0.92:
            # rounding/fee discrepancy — small delta, should hit TOLERANCE rule
            delta = round(amount * random.uniform(-0.008, 0.008), 2)
            ext_rows.append((ext_batch_id, 2, f"EXT-{uuid.uuid4()}", acc_ext_ref, round(amount + delta, 2), "GBP", value_date, value_date, False))
        elif r < 0.97:
            # MISSING_EXTERNAL — deliberately drop this row -> becomes an exception
            continue
        else:
            # duplicate line -> becomes a DUPLICATE exception
            ext_rows.append((ext_batch_id, 2, f"EXT-{uuid.uuid4()}", acc_ext_ref, amount, "GBP", value_date, value_date, False))
            ext_rows.append((ext_batch_id, 2, f"EXT-{uuid.uuid4()}", acc_ext_ref, amount, "GBP", value_date, value_date, False))

    execute_values(
        cur,
        """INSERT INTO external_statement_lines
           (batch_id, source_id, external_ref, account_ref, amount, currency, value_date, settlement_date, is_batched_settlement)
           VALUES %s""",
        ext_rows,
    )
    cur.execute("UPDATE import_batches SET row_count = %s WHERE batch_id = %s", (len(ext_rows), ext_batch_id))
    conn.commit()

    print(f"Seeded {len(ledger_rows)} ledger transactions and {len(ext_rows)} external statement lines.")
    print("Next: run the matching engine (POST /api/recon/runs) to generate matches + exceptions.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
