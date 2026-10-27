import * as fs from "fs";
import * as path from "path";

export function ensureDirSync(dir: string): void {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // На Windows создание вложенной папки через junction иногда даёт ENOENT,
      // хотя её цель доступна. Создаём папку по физическому пути родителя.
      const parent = path.dirname(path.resolve(dir));
      if (parent === path.resolve(dir)) throw error;
      ensureDirSync(parent);
      const physicalParent = fs.realpathSync(parent);
      if (physicalParent === parent) throw error;
      fs.mkdirSync(path.join(physicalParent, path.basename(dir)), { recursive: true });
    }
  }
}
