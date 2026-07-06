# SnapSki Android — план

**Тезис:** на Android не выиграть битву «снять скриншот» — это делает система. Выигрываем на том,
что после снятия: нормальный редактор аннотаций, организованная библиотека вместо свалки в DCIM,
и (позже) синк с десктопом.

Стек: **Kotlin + Jetpack Compose**, minSdk 26, target 36. Собирается на этом ПК
(`%LOCALAPPDATA%\Android\Sdk`, JDK = Android Studio jbr 21). Дистрибуция — сайдлоад APK,
позже свой фид на chat.wishly.wtf/snapski/ как у desktop.

---

## Фаза 1 — MVP (эта итерация)

Поток: **картинка попадает в SnapSki → редактор → библиотека → экспорт**.

1. **Приём картинок**
   - Share target: `ACTION_SEND` / `ACTION_SEND_MULTIPLE` (`image/*`) — «Поделиться → SnapSki»
     из любого приложения, в т.ч. со свежим системным скриншотом.
   - Импорт из галереи через Photo Picker (без storage-разрешений).
2. **Библиотека**
   - Файлы в app-private storage (`filesDir/library`), метаданные в Room
     (id, createdAt, favorite, source, edited).
   - Грид с превью, избранное (звёздочка), мультивыбор → удалить/шарить, полноэкранный просмотр
     (pager, pinch-zoom).
3. **Редактор** (Compose Canvas, вектор поверх bitmap, flatten при сохранении)
   - Инструменты MVP: **crop, стрелка, прямоугольник, перо, текст, blur/pixelate**.
   - Undo/redo, выбор цвета/толщины, «Сохранить» = новая версия в библиотеке
     (оригинал не трогаем).
4. **Экспорт**
   - Share sheet наружу, «Сохранить в галерею» (MediaStore → Pictures/SnapSki),
     копировать в буфер.

Не в MVP: захват экрана, запись, синк, скролл-скриншот.

## Фаза 2 — захват

- `MediaProjection`: разовый грант → foreground service → скриншот по кнопке.
- Quick Settings Tile «Снять» + опциональная плавающая кнопка-оверлей.
- Запись экрана (MediaProjection + MediaRecorder, звук с API 29+).

## Фаза 3 — синк с десктопом

Подробный план: **../PLAN_SYNC.md** — hub на Oracle VM (FastAPI+SQLite за Caddy),
QR-пейринг (пользователи уже есть, токены не зашиваем), тумблер синка, ops-лог LWW.

## Фаза 4 — вишлист

- Скролл-скриншот (длинная страница) — сложно, Accessibility.
- Запись с подсветкой касаний («показать маме куда нажать»).
- OCR текста со скрина (ML Kit on-device).

---

## Структура

```
android/
  app/src/main/java/com/snapski/app/
    MainActivity.kt        — single-activity, NavHost, share-intent intake
    data/                  — Room (ShotEntity, ShotDao, Db), LibraryRepository
    ui/library/            — грид, просмотр, мультивыбор
    ui/editor/             — EditorScreen, EditorState (undo/redo), инструменты, рендер/flatten
    ui/theme/              — тёмная тема в стиле desktop SnapSki
```

Паритет с desktop-редактором (fabric.js) держим по смыслу инструментов, не по коду.
