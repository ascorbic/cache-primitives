import { defineConfig } from "tsdown";
import baseConfig from "../../tsdown.config.ts";

export default defineConfig({
	...baseConfig,
	format: "esm",
	attw: {
		...baseConfig.attw,
		profile: "esmOnly",
	},
});
