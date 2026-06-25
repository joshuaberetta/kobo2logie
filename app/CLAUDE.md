# Backend — Django + DRF

Single Django app for the POC. All backend logic lives here.

## Patterns

- **Models**: Use `models.TextChoices` / `models.IntegerChoices` for enums. Define fields explicitly. Keep everything in `models.py` (no `models/` package).
- **Serializers**: `ModelSerializer` with explicit `fields` and `read_only_fields`. Keep in `serializers.py`.
- **Views**: `ModelViewSet` for standard CRUD. `@api_view` + `@permission_classes` for standalone endpoints (see existing auth views for the pattern).
- **URLs**: Register ViewSets on the `DefaultRouter` in `urls.py`. Auth endpoints use plain `path()` entries. Everything is included under `/api/` by `config/urls.py`.

## Database

- **Local**: SQLite at `db.sqlite3` (no setup needed)
- **Production**: PostgreSQL via `DATABASE_URL` env var, parsed by `dj-database-url`
- Migrations: `python manage.py makemigrations && python manage.py migrate`

## Settings reference (`config/settings.py`)

| Setting                | Source                                              |
| ---------------------- | --------------------------------------------------- |
| `SECRET_KEY`           | `SECRET_KEY` env var (dev fallback provided)        |
| `DEBUG`                | `DEBUG` env var (default `True`)                    |
| `ALLOWED_HOSTS`        | `ALLOWED_HOSTS` env var (comma-separated)           |
| `CORS_ALLOWED_ORIGINS` | `CORS_ALLOWED_ORIGINS` env var (dev: localhost)     |
| `CSRF_TRUSTED_ORIGINS` | `CSRF_TRUSTED_ORIGINS` env var (dev: localhost)     |
| `CSRF_COOKIE_HTTPONLY`  | `False` — lets frontend JS read the CSRF token      |
| `REST_FRAMEWORK`       | Default permission is `AllowAny` (override per view)|
| Static files           | WhiteNoise `CompressedManifestStaticFilesStorage`   |

Register models in `admin.py` for the Django admin panel at `/admin/`.
