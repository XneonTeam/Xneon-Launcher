// Пререлиз (beta/canary). Запускается только пайплайном pre-release.yml.
import { releaseCli } from "./ci-pipeline"

if (import.meta.main) releaseCli("canary").catch(error => { console.error(error); process.exitCode = 1 })
