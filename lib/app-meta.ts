import packageJson from "@/package.json"

export const APP_NAME = packageJson.build?.productName ?? packageJson.name
export const APP_VERSION = packageJson.version
