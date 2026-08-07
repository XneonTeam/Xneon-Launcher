export type CloudCredentials = {
  googleDrive: { clientId: string; clientSecret: string }
  dropbox: { clientId: string }
  yandex: { clientId: string }
  onedrive: { clientId: string }
  elyby: { clientId: string; clientSecret: string }
  xnskins: { clientId: string; clientSecret: string }
}

const EMPTY: CloudCredentials = {
  googleDrive: { clientId: "", clientSecret: "" },
  dropbox: { clientId: "" },
  yandex: { clientId: "" },
  onedrive: { clientId: "" },
  elyby: { clientId: "", clientSecret: "" },
  xnskins: { clientId: "", clientSecret: "" },
}

let cached: CloudCredentials | null = null

export function getCloudCredentials(): CloudCredentials {
  if (cached) return cached
  try {
    const generated = require("./credentials.generated") as { cloudCredentials?: CloudCredentials }
    if (generated?.cloudCredentials) cached = generated.cloudCredentials
  } catch {
    /* credentials.generated.ts не создан — используем пустые значения */
  }
  if (!cached) cached = EMPTY
  return cached
}
