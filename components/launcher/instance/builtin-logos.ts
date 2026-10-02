/**
 * Встроенные логотипы Xneon в виде инлайн-SVG.
 *
 * Исходники лежат в `public/launcher-icons/xneon_logo_*.svg` и покрашены жёстко
 * (`#f97316`). Здесь тот же рисунок, но с `fill="currentColor"`, поэтому иконка
 * берёт цвет из темы (`text-primary`) и меняется вместе с ней.
 *
 * `src` совпадает с путём исходного файла — это значение хранится в иконке
 * сборки/сервера, поэтому старые записи продолжают работать.
 */
export interface BuiltinLogo {
  id: string
  /** Путь исходного файла — то, что лежит в данных сборки/сервера. */
  src: string
  /** Разметка SVG с `currentColor` вместо фиксированного цвета. */
  svg: string
}

export const BUILTIN_LOGOS: BuiltinLogo[] = [
  { id: "logo-1", src: "./launcher-icons/xneon_logo_01.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 276 281" width="276" height="281"><path d="M 137 164 L 139 171 L 150 177 L 193 222 L 201 225 L 255 225 L 165 135 Z M 26 55 L 94 123 L 123 92 L 86 56 Z M 275 6 L 210 41 L 160 75 L 85 161 L 6 274 L 57 236 L 140 182 L 106 184 L 133 148 L 187 89 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-2", src: "./launcher-icons/xneon_logo_02.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="57 19 214 253" width="214" height="253"><path d="M 162 25 L 63 84 L 63 153 L 79 144 L 83 145 L 75 157 L 64 165 L 64 207 L 164 266 L 164 236 L 126 211 L 168 173 L 204 210 L 203 214 L 182 226 L 181 256 L 265 207 L 265 84 L 182 34 L 182 64 L 234 95 L 236 99 L 203 101 L 167 130 L 138 100 L 132 89 L 113 104 L 110 113 L 146 152 L 102 198 L 89 191 L 89 99 L 164 55 Z M 240 107 L 241 190 L 229 196 L 193 157 L 190 150 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-3", src: "./launcher-icons/xneon_logo_03.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 304 242" width="304" height="242"><path d="M 297 232 L 217 99 L 156 6 L 86 109 L 6 235 L 64 212 L 122 183 L 126 184 L 142 220 L 142 145 L 70 185 L 66 182 L 154 55 L 160 58 L 241 180 L 238 183 L 168 145 L 168 220 L 185 184 L 189 183 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-4", src: "./launcher-icons/xneon_logo_04.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 247 259" width="247" height="259"><path d="M 198 196 L 160 198 L 131 209 L 110 209 L 94 205 L 74 220 L 103 230 L 139 230 L 168 220 Z M 212 68 L 197 86 L 205 110 L 206 134 L 201 154 L 191 171 L 204 188 L 218 168 L 228 133 L 226 101 Z M 240 6 L 147 81 L 123 108 L 120 108 L 93 81 L 53 81 L 52 78 L 66 62 L 92 46 L 112 41 L 131 41 L 159 48 L 179 33 L 143 17 L 111 15 L 72 27 L 43 50 L 22 83 L 14 114 L 17 149 L 34 182 L 43 164 L 36 120 L 41 98 L 50 81 L 54 81 L 101 131 L 62 176 L 6 252 L 91 182 L 120 153 L 123 153 L 159 190 L 201 191 L 150 138 L 144 128 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-5", src: "./launcher-icons/xneon_logo_05.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 176 261" width="176" height="261"><path d="M 58 160 L 59 222 L 87 204 L 89 199 L 73 174 Z M 6 51 L 6 254 L 40 234 L 41 123 L 169 238 L 169 192 L 40 75 Z M 169 6 L 84 60 L 69 88 L 105 88 L 106 72 L 136 55 L 137 140 L 168 170 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-6", src: "./launcher-icons/xneon_logo_06.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 268 283" width="268" height="283"><path d="M 11 150 L 41 159 L 94 183 L 113 221 L 132 276 L 132 191 L 122 178 L 114 160 L 86 150 Z M 141 36 L 142 104 L 155 128 L 187 140 L 186 144 L 154 157 L 141 183 L 142 241 L 152 215 L 173 179 L 211 159 L 261 141 L 208 121 L 173 104 L 150 62 Z M 134 6 L 112 69 L 95 103 L 66 120 L 6 143 L 84 140 L 114 128 L 132 96 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-7", src: "./launcher-icons/xneon_logo_07.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 267 245" width="267" height="245"><path d="M 234 94 L 214 118 L 212 132 L 202 154 L 176 184 L 134 210 L 107 218 L 130 221 L 149 219 L 171 212 L 195 197 L 215 176 L 230 148 L 235 128 Z M 260 7 L 163 67 L 129 98 L 103 78 L 69 60 L 80 84 L 104 123 L 6 238 L 102 171 L 126 147 L 129 147 L 157 177 L 180 152 L 154 124 L 154 117 Z M 186 21 L 152 8 L 113 7 L 88 14 L 53 36 L 27 69 L 16 103 L 17 135 L 31 169 L 38 153 L 34 124 L 37 102 L 48 77 L 68 53 L 88 39 L 109 31 L 138 29 L 164 35 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-8", src: "./launcher-icons/xneon_logo_08.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 267" width="220" height="267"><path d="M 200 129 L 139 182 L 140 206 L 200 158 Z M 19 129 L 19 158 L 80 206 L 80 181 Z M 212 53 L 139 109 L 140 161 L 212 91 Z M 6 53 L 7 90 L 80 161 L 80 108 Z M 109 6 L 89 55 L 89 97 L 93 110 L 93 199 L 110 260 L 126 201 L 126 118 L 130 104 L 130 54 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-9", src: "./launcher-icons/xneon_logo_09.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 243" width="250" height="243"><path d="M 155 119 L 140 149 L 168 177 L 207 178 Z M 235 83 L 213 105 L 212 192 L 101 192 L 81 213 L 235 213 Z M 159 24 L 29 24 L 29 170 L 50 150 L 50 46 L 139 45 Z M 243 6 L 155 68 L 132 92 L 96 60 L 77 61 L 72 70 L 106 112 L 107 118 L 6 236 L 112 157 L 157 110 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
  { id: "logo-10", src: "./launcher-icons/xneon_logo_10.svg", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 214 279" width="214" height="279"><path d="M 158 135 L 136 114 L 134 124 L 106 150 L 79 125 L 44 124 L 85 174 L 6 272 L 83 217 L 104 197 L 111 199 L 117 206 L 124 224 L 115 272 L 159 229 L 158 193 L 150 197 L 130 174 Z M 29 85 L 17 99 L 9 116 L 6 151 L 18 181 L 38 203 L 54 179 L 42 166 L 35 151 Z M 136 50 L 138 90 L 169 122 L 178 139 L 179 158 L 171 176 L 173 215 L 192 196 L 204 173 L 207 159 L 205 130 L 191 103 Z M 106 6 L 36 77 L 36 100 L 40 117 L 101 55 L 106 44 Z" fill="currentColor" fill-rule="evenodd"/></svg>` },
]

/** Встроенный логотип по значению иконки или `null`, если это своя картинка. */
export function findBuiltinLogo(src?: string | null): BuiltinLogo | null {
  if (!src) return null
  return BUILTIN_LOGOS.find(logo => logo.src === src) ?? null
}

export function isBuiltinLogo(src?: string | null): boolean {
  return findBuiltinLogo(src) !== null
}
