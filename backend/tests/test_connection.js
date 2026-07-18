import pg from "pg";

async function test(host) {
  console.log(`Testing connection to ${host}...`);
  const client = new pg.Client({
    host,
    port: 5433,
    user: "postgres",
    password: "change_me_in_env",
    database: "reconengine_test",
  });
  try {
    await client.connect();
    console.log(`SUCCESS connected to ${host}!`);
    await client.end();
  } catch (err) {
    console.error(`FAILED to connect to ${host}: ${err.message}`);
  }
}

async function run() {
  await test("127.0.0.1");
  await test("localhost");
}

run();
