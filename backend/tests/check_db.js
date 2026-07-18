import pg from "pg";

async function main() {
  const ports = [5432, 5433];
  for (const port of ports) {
    console.log(`Checking Postgres on port ${port}...`);
    const client = new pg.Client({
      host: "localhost",
      port,
      user: "postgres",
      password: "change_me_in_env",
      database: "postgres",
    });
    try {
      await client.connect();
      console.log(`Successfully connected as postgres on port ${port}!`);
      const res = await client.query("SELECT datname FROM pg_database");
      console.log("Databases:", res.rows.map(r => r.datname));
      await client.end();
      return;
    } catch (e) {
      console.error(`Failed on port ${port}:`, e);
    }
  }
}

main();
