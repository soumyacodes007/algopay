import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        testTimeout: 30000, // 30s for network tests
        hookTimeout: 30000,
        reporters: ["verbose"],
    },
});
