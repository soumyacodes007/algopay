import "dotenv/config";
import { IntermezzoClient } from "./src/wallet/intermezzo.js";

async function run() {
    const client = new IntermezzoClient();
    try {
        const res = await client.createAccount("test_user_id_1");
        console.log("Create 1:", res);
        const res2 = await client.createAccount("test_user_id_1");
        console.log("Create 2:", res2);
        const res3 = await client.getUser("test_user_id_1");
        console.log("Get:", res3);
    } catch (e) {
        console.error(e.message);
    }
}
run();
