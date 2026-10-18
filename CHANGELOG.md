## [1.0.6] ([1.0.5...1.0.6](https://github.com/XneonTeam/Xneon-Launcher/compare/v1.0.5..v1.0.6)) - 2026-10-03


### Внутренние работы

- Bump launcher to 1.0.6 and switch servers to registry ([410d35d](https://github.com/XneonTeam/Xneon-Launcher/commit/410d35d6efeefcbaf655ebae6c6c1bb06bc9125c))
- Игнорировать локальные артефакты отладки и проверок ([4cfa6b6](https://github.com/XneonTeam/Xneon-Launcher/commit/4cfa6b687e93c716c844773f2481be476c16fa82))
- *(app)* Оболочка, контексты и main-процесс ([a26045d](https://github.com/XneonTeam/Xneon-Launcher/commit/a26045d479c67aa427078bc8ada2aed7dbde82e1))
- *(deps)* Перейти на better-sqlite3 и workspace-линковку @xnlc ([398a69e](https://github.com/XneonTeam/Xneon-Launcher/commit/398a69ea25b2e545894ec03fb69af0c9027c0a51))
- *(scripts)* Убрать битые test:skins и test:xn-auth, синхронизировать доки ([c804c98](https://github.com/XneonTeam/Xneon-Launcher/commit/c804c9862daed0bed68210be84076cb066dee47e))
- *(docs)* Удалить RELEASE_1.0.6_CHANGELOG.md ([03515b3](https://github.com/XneonTeam/Xneon-Launcher/commit/03515b34ef438f7cbe7e8f3f9d311f6a222ec864))
- Убрать мёртвый код, лишние зависимости и служебные документы ([ff383b6](https://github.com/XneonTeam/Xneon-Launcher/commit/ff383b6c822dc2d989ae9de25dc38f9b70ba6874))
- *(i18n)* Убрать неиспользуемые строки, добавить строки серверов, AI и консоли ([7572cb2](https://github.com/XneonTeam/Xneon-Launcher/commit/7572cb2b8c0017feda11450e3260e5f092f4c922))
- *(release)* Собирать локальные пакеты @xnlc перед сборкой приложения ([3e8327f](https://github.com/XneonTeam/Xneon-Launcher/commit/3e8327f59b64bfb5005efd9418d4a7587141f881))
- Писать бренд как Xneon вместо XNeon ([177cb09](https://github.com/XneonTeam/Xneon-Launcher/commit/177cb09a1fcd6279f310124bc4db5ee3329fac3e))


### Документация

- Skins cape renderer comment mentions only textures.minecraft.net ([61f0488](https://github.com/XneonTeam/Xneon-Launcher/commit/61f0488ad408ea00e753737f256f6085220c316f))
- Changelog 1.0.6 — сводка отличий от 1.0.5 ([53b2d2d](https://github.com/XneonTeam/Xneon-Launcher/commit/53b2d2d6684515744ac62b92c7473503a77157c1))
- Скриншоты интерфейса в changelog 1.0.6 ([32d2dc3](https://github.com/XneonTeam/Xneon-Launcher/commit/32d2dc31a3c5c7e1c3097753a0f2e89128e204c1))
- Пересъёмка битых скриншотов и скины с аккаунтом Microsoft ([9a2eed3](https://github.com/XneonTeam/Xneon-Launcher/commit/9a2eed3ee3959334917fce1600bdf921725ade90))
- Обновить changelog 1.0.6 ([359b25b](https://github.com/XneonTeam/Xneon-Launcher/commit/359b25b4f66c0664b61ce9b2c763b43c6de6bbc2))
- Аудит оптимизации и материалы релиза 1.0.6 build 3 ([f709c09](https://github.com/XneonTeam/Xneon-Launcher/commit/f709c09c49d45d1102298bec0122919578c09cd8))
- *(agents)* Описать домен скинов и пакет @xnlc/skins ([f204900](https://github.com/XneonTeam/Xneon-Launcher/commit/f20490011c671949ba18272d9eca1d113011b158))
- Обновить README под 1.0.6 ([c8903e6](https://github.com/XneonTeam/Xneon-Launcher/commit/c8903e682f67c2a49e9574b1d5699ff4359c74f2))


### Исправления

- Prism syntax highlighting broke packaged build (splash hang) ([dda7004](https://github.com/XneonTeam/Xneon-Launcher/commit/dda7004face0b7e0f57a6284404180171279547d))
- Cloud page load, changelog linkout, CF source and channel meta ([f3f92f7](https://github.com/XneonTeam/Xneon-Launcher/commit/f3f92f70744f8161916b2c4e7f2bf91d2b8cfde1))
- Default mod loader version to latest instead of recommended ([8359a6c](https://github.com/XneonTeam/Xneon-Launcher/commit/8359a6c97a5fb32e882a5753f50b215091b82bef))
- *(forge)* Загрузчик Forge в модпаках и JNA в профиле запуска ([dc67d51](https://github.com/XneonTeam/Xneon-Launcher/commit/dc67d51a82d46e0b9fe221d0d5474f2ed91b7db6))
- *(core)* Учитывать rules при склейке библиотек + промт AI без чужих лаунчеров ([1f60284](https://github.com/XneonTeam/Xneon-Launcher/commit/1f60284a2cda641ee796ec3fb59f74123041c0ce))
- *(neoforge)* Запуск NeoForge 21.x — ванильный клиент в поле jar ([941e902](https://github.com/XneonTeam/Xneon-Launcher/commit/941e902bdeeeb5c932d8d13696af1b9f0c995b5b))
- *(db)* Чистить статистику удалённых сборок и серверов, читать по диапазону ([11332b0](https://github.com/XneonTeam/Xneon-Launcher/commit/11332b0fe1b82eddd764e4e9400faea7231d949a))
- *(builds)* Корзина, статистика, имена папок и .litemod ([c9bc869](https://github.com/XneonTeam/Xneon-Launcher/commit/c9bc869bf0320714e21a1b6d61203412b3a925f2))
- *(servers)* Надёжные пути, автоскачивание Java и стабильный UI ([4a50d8f](https://github.com/XneonTeam/Xneon-Launcher/commit/4a50d8fcf95737d04780cf6de617c57983d0fb4e))
- *(main)* Гасить RPC-клиент, таймеры обмена кода и логировать сбои IPC ([a61219d](https://github.com/XneonTeam/Xneon-Launcher/commit/a61219dc94e8e41f4486d2759094549746daf6e2))
- *(launch)* Уважать настройки памяти и лимит командной строки ([242ed9b](https://github.com/XneonTeam/Xneon-Launcher/commit/242ed9bc84637b8939a7165f2fa1aca42cf95c96))
- *(skins)* Источник скина и общий слой отправки текстуры ([38680ae](https://github.com/XneonTeam/Xneon-Launcher/commit/38680ae495318569bd6ce4369e52d5c48af2b6e1))
- *(renderer)* ErrorBoundary, code-splitting и стабильный список сборок ([0a8f4c4](https://github.com/XneonTeam/Xneon-Launcher/commit/0a8f4c42229b5af7453cfb4ca808747a5cc427ac))
- *(ui)* Настройки, пустые состояния, логи и Quick Play ([9f311a1](https://github.com/XneonTeam/Xneon-Launcher/commit/9f311a10217897a52e2bad571e021a713fee9d7c))
- *(builds)* Считать мод установленным по slug/имени и обновлять кэш контента ([6cd3737](https://github.com/XneonTeam/Xneon-Launcher/commit/6cd373769ab6d0abc797db9d6cb2fa32c1030e46))
- *(skins)* Определять надетый скин по отметке и не показывать пустую отмену ([7afc0ea](https://github.com/XneonTeam/Xneon-Launcher/commit/7afc0ea0540218f444b03dc4d6693f87942c72d4))
- *(ui)* Читалка новостей, логи, центрирование иконок и промо AI ([8ff3786](https://github.com/XneonTeam/Xneon-Launcher/commit/8ff3786b1a5120c21ff10dbd4843f85d9c03589c))
- *(skins)* Превью карточек не пропадают при быстром листании «Избранного» ([51791e3](https://github.com/XneonTeam/Xneon-Launcher/commit/51791e3a58e764db85bbc361eaa68459e7e2fcad))
- *(types)* Перенести ServerStatusResult в @xnlc/types и разорвать цикл с @xnlc/servers ([f03629c](https://github.com/XneonTeam/Xneon-Launcher/commit/f03629c355859f5e179ee7ca7cbf43ca7136f4c8))


### Новые возможности

- AI streaming, after-launch setting, mod search cache, icon fixes ([938c293](https://github.com/XneonTeam/Xneon-Launcher/commit/938c293ba3f8e1ffb114d73ca566bc846e0c5b7c))
- MC server management - create, run, monitor, configure, manage players and files; @xnlc/servers package, modular DB, server browse, addons, pack install, trash view ([ed145cb](https://github.com/XneonTeam/Xneon-Launcher/commit/ed145cbe652b402344592f053fda096d806d5946))
- Localize hardcoded UI strings to i18n (ru/en/de/es/uk) ([afeb5cd](https://github.com/XneonTeam/Xneon-Launcher/commit/afeb5cd93c202e4fac7d3b3a32ba8de196f2114e))
- Add servers tab to sidebar ([542e405](https://github.com/XneonTeam/Xneon-Launcher/commit/542e4050269fcdfddfad4514f66c8a265b239b62))
- Remove deprecated P2P multiplayer system ([14509ff](https://github.com/XneonTeam/Xneon-Launcher/commit/14509fff2cf1ea1e23345b173ef09dd636dee62c))
- XN Connect tunnel limit enforcement with usage counter ([7594635](https://github.com/XneonTeam/Xneon-Launcher/commit/7594635786eaac537ff91864e0ebc24a578fdd8d))
- Server context menu, duplicate/export, trash tunnel cleanup, resolver fixes ([f9ce814](https://github.com/XneonTeam/Xneon-Launcher/commit/f9ce81431ee35103b4ddf94041b24a2c635ad515))
- Selective cloud upload, cloud fixes, stats and icon improvements ([317e790](https://github.com/XneonTeam/Xneon-Launcher/commit/317e790439c0ce622958d8ff837fb42093df7273))
- Server metrics removal, version install progress, cloud archive meta ([2d3cf7d](https://github.com/XneonTeam/Xneon-Launcher/commit/2d3cf7d6b3aa7d89f90a451a5189dbd5fb7c12a8))
- Stats range picker, trash build icons, immediate build field save ([3b5632d](https://github.com/XneonTeam/Xneon-Launcher/commit/3b5632d4e818f63c1d57ba1419a7a832679f076e))
- Server groups, faster modlist export, skins cleanup, markdown tables ([5c1bd6c](https://github.com/XneonTeam/Xneon-Launcher/commit/5c1bd6c159c3556101fa65e58164d0f8c622abeb))
- Quick play status and launch, shared category menu, server version fix ([d33b9f5](https://github.com/XneonTeam/Xneon-Launcher/commit/d33b9f54b1458763cfd8ceb6856232cdd488cdcc))
- *(ipc)* Синхронизировать контракты, preload-мост и типы ([d218de6](https://github.com/XneonTeam/Xneon-Launcher/commit/d218de69c87972dfcb60da5ddc7e1bcadace27e5))
- *(servers)* Раздел «Серверы», менеджер процессов и XN Connect ([c11f4cc](https://github.com/XneonTeam/Xneon-Launcher/commit/c11f4cc2d3d53ba5579ae429d590033470c6c205))
- *(builds)* Экспорт и импорт сборок в собственном формате ([505bd2e](https://github.com/XneonTeam/Xneon-Launcher/commit/505bd2e0b05e0a854913f9eb95ea417a1162808f))
- *(launch)* Команды запуска, wrapper, окружение и быстрый запуск ([8a81262](https://github.com/XneonTeam/Xneon-Launcher/commit/8a812622464114dd543021b4cb214d5cf9593ea8))
- *(content)* Зависимости контента и идентичность по id проекта ([17373e9](https://github.com/XneonTeam/Xneon-Launcher/commit/17373e97b3faa308ec0a705087da50b8ac772c24))
- *(ui)* Единый слой модалок, пустые состояния и иконки ([29caed1](https://github.com/XneonTeam/Xneon-Launcher/commit/29caed1a62ed1365c08b1e5a6612db5581b41480))
- *(cloud)* Выборочная загрузка и импорт, метаданные архивов ([442c5b6](https://github.com/XneonTeam/Xneon-Launcher/commit/442c5b61fe59705440c995a40c23f0bbb9672e24))
- *(settings)* Страницы настроек и хранилище ([6aab82f](https://github.com/XneonTeam/Xneon-Launcher/commit/6aab82f61474f4a6ad650737ab2788c905f70dd2))
- *(pages)* Статистика, логи и скины ([0972a22](https://github.com/XneonTeam/Xneon-Launcher/commit/0972a225fc6f63034c14ed369fd11034c330996d))
- *(i18n)* Строки для серверов, сборок, запуска и облака ([49075b2](https://github.com/XneonTeam/Xneon-Launcher/commit/49075b2bb2ec593bf559929fc8d2a405d9873f73))
- *(packs)* Докачивание обязательных модов пака ([8fda5ac](https://github.com/XneonTeam/Xneon-Launcher/commit/8fda5ac4088d15be8d6081f548b5dcfb9b7ea88e))
- *(ui)* Открыть страницу проекта из каталогов ([21334a7](https://github.com/XneonTeam/Xneon-Launcher/commit/21334a7fba2212ed10d0cb5dca1d2920fc49181e))
- *(db)* Хранить источник скина и искать записи библиотеки по id ([5c49f0e](https://github.com/XneonTeam/Xneon-Launcher/commit/5c49f0ecfddbd92d5b13d96805e011116b4d1cd7))
- *(ipc)* Синхронизировать контракты, preload и модель каталога Laby ([b8e4e7f](https://github.com/XneonTeam/Xneon-Launcher/commit/b8e4e7feb97f8e6a7367af792320fb30015f048e))
- *(laby)* Добавить клиент каталога Laby в main-процессе ([d17b3eb](https://github.com/XneonTeam/Xneon-Launcher/commit/d17b3eb7d017cf73dbd18bcdd5b7161dac18a732))
- *(mods)* Каталог и фильтры FTB вместо короткой выдачи featured ([b59e428](https://github.com/XneonTeam/Xneon-Launcher/commit/b59e42890427ec58eba0ee8f20c8234369609d8a))
- *(skins)* Вкладка «Скины» с каталогом Laby, избранным и элитрой ([faadb82](https://github.com/XneonTeam/Xneon-Launcher/commit/faadb8279726d018a09643e38a449eb6d74404b4))
- *(i18n)* Строки Laby, скинов, ошибок и лимитов ([c01695e](https://github.com/XneonTeam/Xneon-Launcher/commit/c01695ebfcf9e045c4c7783ba0bbeb427dec432e))
- *(skins)* Выделить домен скинов в пакет @xnlc/skins ([52404cb](https://github.com/XneonTeam/Xneon-Launcher/commit/52404cba8dcb331aa23b07991461dc9c0fd95de8))
- *(servers)* Прогресс установки ядра и вывод установщика в консоль ([944b874](https://github.com/XneonTeam/Xneon-Launcher/commit/944b8740c6fc8d7592d524c259a561fab40820f3))


### Производительность

- *(builds)* Лёгкий список сборок и ленивый контент ([647c8bf](https://github.com/XneonTeam/Xneon-Launcher/commit/647c8bf6ada1c52ae46812ad0bcc1947749acafd))
- *(builds)* Точечное сохранение правок вместо перезаписи таблицы ([2fcd70c](https://github.com/XneonTeam/Xneon-Launcher/commit/2fcd70c28b382c66f2205e3ee490c3c14b1b0abb))
- *(db)* Перевести слой БД на better-sqlite3 с версионированием схемы ([c6ac65e](https://github.com/XneonTeam/Xneon-Launcher/commit/c6ac65ec3349df2738777f956d4d58f44c0be46b))
- *(db)* Батчевые записи, кэш настроек и upsert сборок ([7c9abe7](https://github.com/XneonTeam/Xneon-Launcher/commit/7c9abe7256561b6e88a9f6155db9d2f451229bde))
- *(builds)* Один проход по JAR и холодный скан в worker-потоке ([82879c7](https://github.com/XneonTeam/Xneon-Launcher/commit/82879c728eda09e663447917e28f9d571ca0fdeb))
- *(main)* Кэшировать Java-детект, размеры миров и скриншоты ([4742807](https://github.com/XneonTeam/Xneon-Launcher/commit/4742807f8e3ff2960406eb545c72bbc2f2926d96))
- *(core)* Кэшировать готовность ассетов и resolveLibraries ([27c8ac6](https://github.com/XneonTeam/Xneon-Launcher/commit/27c8ac6326d1d2060696a7e9dd84197b906bc5da))
- *(db)* Индекс по (accountId, sourceId) для поиска в избранном ([d78a083](https://github.com/XneonTeam/Xneon-Launcher/commit/d78a0833bb568504394cc6865dcb8a461cd0eb56))
- *(ftb)* Собирать каталог один раз, держать его в кэше долго и класть кэш в данные лаунчера ([1c70ff1](https://github.com/XneonTeam/Xneon-Launcher/commit/1c70ff1cdb8fc975a60e3aedd68560d1e45566b0))


### Рефакторинг

- Remove [XNLC] log prefix, improve sync-local-xnlc symlink check, simplify afterLaunch restore ([3fe4802](https://github.com/XneonTeam/Xneon-Launcher/commit/3fe48029af7ce30a240d3f9e17080389436d8856))
- Deduplicate shared types, error helpers, and IPC contracts ([d60424c](https://github.com/XneonTeam/Xneon-Launcher/commit/d60424cf6039b2e816ec8acb6c95d6946aa42698))
- Share addon UI components between builds and servers ([4bddcdb](https://github.com/XneonTeam/Xneon-Launcher/commit/4bddcdb569153bf2204ee6c96724ab45a8763667))
- *(servers)* Вынести XN-Connect в свой модуль и подключить хендлеры ([ec2aa18](https://github.com/XneonTeam/Xneon-Launcher/commit/ec2aa181bf8aa02a12d7da0f9a289e64dfb99424))
- *(cloud)* Общий loopback-OAuth, хранилище токенов и категории ([7a6e68f](https://github.com/XneonTeam/Xneon-Launcher/commit/7a6e68f5a9beb29f916d13daa70a62e7cdd7c211))
- *(cloud-ui)* Единые иконки провайдеров и сброс к списку хранилищ ([bf5085e](https://github.com/XneonTeam/Xneon-Launcher/commit/bf5085e4ee2896d3766f02fb7cda4ca1540a7d0a))
- *(import)* Общий обход инстансов и better-sqlite3 для чужой БД ([0505533](https://github.com/XneonTeam/Xneon-Launcher/commit/0505533513169f25d2ac1167fe67a75f594b4ae2))
- *(ui)* Общий диалог категорий и фильтры FTB в сборках ([db25805](https://github.com/XneonTeam/Xneon-Launcher/commit/db2580517e70acbfde78c1513dbcc2f592b326eb))
- *(types)* В Laby оставить только контракты, убрать снятые каналы ([1ec4ddd](https://github.com/XneonTeam/Xneon-Launcher/commit/1ec4ddd8db5d0956ff971230aba1f84a3df12dd4))
- *(skins)* Тонкий IPC-слой main на портах домена ([a103993](https://github.com/XneonTeam/Xneon-Launcher/commit/a1039938e3c24098a88f5c41710545bc468825bb))
- *(skins-ui)* Общие части панелей, помощники пакета и ошибки надевания ([866bea5](https://github.com/XneonTeam/Xneon-Launcher/commit/866bea584f287ea1c53efe6ee3ad82aadeb7a881))

