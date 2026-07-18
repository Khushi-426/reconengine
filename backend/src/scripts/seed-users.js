import pg from "pg";
import bcrypt from "bcrypt";

async function run() {
  const client = new pg.Client({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "change_me_in_env",
    database: process.env.DB_NAME || "reconengine",
  });
  
  try {
    await client.connect();
    const hash = await bcrypt.hash("Password123!", 10);
    
    const users = [
      { email: "admin@reconengine.local", name: "System Admin", role: 1 },
      { email: "approver@reconengine.local", name: "Ops Approver", role: 2 },
      { email: "analyst@reconengine.local", name: "Ops Analyst", role: 3 },
      { email: "auditor@reconengine.local", name: "Compliance Auditor", role: 4 },
    ];
    
    for (const u of users) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [u.email, hash, u.name, u.role]
      );
      console.log(`Seeded user: ${u.email} (Password: Password123!)`);
    }
  } catch (err) {
    console.error("Failed to seed users:", err);
  } finally {
    await client.end();
  }
}

run();
