# SnapSki Sync (фаза 3) — план

**Цель:** общая библиотека скриншотов между устройствами одного человека
(Android ⇄ Desktop), синк через мини-hub на Oracle VM. У SnapSki уже есть
пользователи → мультиюзерность и QR-пейринг закладываем сразу.

## Модель

- **Sync group** = один человек со своими устройствами. Никаких аккаунтов/паролей.
- Первое устройство (обычно desktop) генерирует `group_id` (UUID) + `token`
  (32 случайных байта, base64) и регистрирует группу на hub'е. Сервер хранит
  только **хэш** токена.
- **Пейринг**: desktop показывает QR + копируемую строку-код (один и тот же
  payload: `snapski://pair?v=1&url=<hub>&g=<group_id>&t=<token>`).
  Телефон сканирует QR; второй desktop вставляет строку. Всё, устройства в группе.
- Клиенты шлют `Authorization: Bearer <group_id>:<token>` в каждом запросе.
- Шоты **иммутабельны** (id, png, meta). Избранное/удаление = операции в ops-логе,
  конфликты решаются last-write-wins по таймстампу клиента.
- Курсор синка: у каждой записи (shot или op) серверный монотонный `seq`
  (AUTOINCREMENT). Клиент хранит последний виденный `seq`, спрашивает `?since=`.

## 3a. Hub (Oracle VM)

FastAPI + SQLite + файлы. Отдельный от firefly: свой venv, свой systemd-юнит
`snapski-hub.service`, данные в `/home/ubuntu/snapski-hub/data/` (файлы по
`{group_id}/{shot_id}.png`). Код в монорепо `hub/`.

Endpoints (все под токеном, кроме register):
- `POST /register` — {group_id, token_hash саморегистрация}; first-come, идемпотентно.
- `POST /shots` — multipart: meta JSON (id, createdAt, favorite, source) + PNG.
  Дедуп по id (клиентский id = уникальный). Ответ: seq.
- `GET /changes?since=<seq>` — список событий: `{seq, kind: shot|favorite|delete, ...meta}`
  (без бинарей). Лимит 200 за раз.
- `GET /shots/{id}/file` — PNG.
- `POST /ops` — {kind: favorite|delete, shot_id, value?, ts}.
- `GET /health`.

Квота: 2 ГБ на группу; при превышении — отказ 507 (клиент показывает
«хранилище синка заполнено»), автоэвикцию НЕ делаем в v1 (удаление молча —
хуже, чем честная ошибка).

Caddy: route `chat.wishly.wtf/snapski-hub/*` → localhost:8790
(⚠️ scoped matcher, помним готчу с /admin*).
Деплой: git pull на VM (репо PRIVATE уже есть) + systemd. Smoke-тест curl'ом.

## 3b. Android-клиент

- `SyncEngine` (в `data/sync/`): очередь аплоада (все локальные шоты без
  флага uploaded) + pull `/changes` → применить к библиотеке (докачать PNG,
  favorite/delete LWW; локальные правки шлём как ops).
- Индекс: в `Shot` добавить `uploadedSeq: Long?`/`pendingOps`; курсор в
  SharedPreferences.
- **WorkManager**: expedited OneTime на каждое сохранение (capture/edit/import)
  + Periodic 30 мин; плюс pull при выходе приложения на foreground.
- **Пейринг**: экран Settings → «Подключить синк» → сканер QR
  (zxing-android-embedded, лёгкая либа) + поле «вставить код вручную»
  (fallback). Хранение token'а — EncryptedSharedPreferences.
- **Тумблер «Синк»** в Settings: off = очередь стоит, ничего не уходит;
  on = досылает накопленное. (Открытый вопрос на потом: per-shot «не синкать».)
- Статус в Settings: последний синк, штук в очереди, занято на сервере.

## 3c. Desktop-клиент (Electron)

- Settings: «Включить синк» → генерирует group+token, регистрирует, показывает
  QR (qrcode npm) + копируемый код; или «Присоединиться» — вставить код.
- Фоновый цикл в main-процессе: push новых капчей + pull /changes каждые 30 сек
  (или long-poll позже). Пришедшие шоты попадают в обычную галерею с бейджем
  источника («с телефона»).
- Токен — в electron-store (или safeStorage).

## 3d. Потом / вишлист

- Chrome-расширение: тот же REST, пейринг вставкой кода.
- Share-links: `GET /s/<short>` публичная ссылка на один шот (фундамент уже есть).
- Тумбы на сервере (`?w=`) для быстрых гридов.
- Ротация токена / выкидывание устройства (v1: сменить токен = новая группа).

## Порядок работ

1. 3a hub + деплой + curl-тесты (полдня).
2. 3b Android push-only (скрины улетают на VM) → потом pull.
3. 3c Desktop QR + полный двусторонний.
4. Прогон вдвоём: телефон↔ПК, офлайн-очередь, тумблер.

Версии: Android v0.5.x, Desktop 0.2.x. Релиз desktop — как обычно через
scripts/publish-update.sh; Android — сайдлоад APK (release-подпись всё ещё TODO).
