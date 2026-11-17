// Стабильный релиз (release). Запускается только пайплайном release.yml.
import { releaseCli } from "./ci-pipeline"

if (import.meta.main) releaseCli("stable").catch(error => { console.error(error); process.exitCode = 1 })
