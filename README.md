# PsychoForm / BFA Digital

Plataforma web integral para la **creación de tests**, **configuración de puntuación automática** y **monitoreo en tiempo real de sesiones de aplicación**, diseñada principalmente para **evaluaciones y tests psicológicos** (con soporte inicial orientado a la **Batería Factorial de Aptitudes — BFA**).

---

## ¿Qué es este proyecto?

El sistema digitaliza el ciclo completo de una evaluación psicológica controlada: desde el diseño del instrumento y la definición de sus reglas de calificación, hasta la supervisión de sesiones grupales o individuales y la generación de reportes.

### Pilares funcionales

1. **Motor de creación de tests (`instruments`)**
   - Configuración de instrumentos, subtests, versiones y estados de publicación.
   - Gestión de ítems, opciones de respuesta, recursos gráficos/imágenes, instrucciones y tiempos límite.
   - Soporte para múltiples instrumentos y catálogos académicos/demográficos asociados.

2. **Motor de puntuación automática (`scoring`)**
   - Definición de claves de respuesta, reglas de calificación y baremos validados.
   - Cálculo automático de puntuaciones directas y resultados al finalizar la evaluación.
   - Consulta de resultados individuales y agregados, con generación de reportes y exportación.

3. **Monitoreo y control de sesiones (`sessions` y `assessment`)**
   - Creación, apertura, pausa, reanudación y cierre de sesiones de evaluación supervisadas.
   - Seguimiento del avance de participantes, guardado incremental de respuestas y control de intentos.
   - Trazabilidad mediante registro de auditoría (`audit`) para accesos, cambios y consultas sensibles, además de respaldos (`backup`).

---

## Estructura del repositorio

Este repositorio unifica el backend, la base de datos y la interfaz web:

```text
Proyecto unificado/
├── bfa-digital/                # Frontend web (React + TypeScript + Vite)
│   ├── src/
│   │   ├── api/                # Cliente HTTP y contratos de API
│   │   ├── features/           # Módulos: instruments, sessions, runtime, results, reports, participants, admin, etc.
│   │   ├── routes/             # Enrutamiento con TanStack Router (/app, /evaluacion, /login, etc.)
│   │   └── store/              # Estado global con Zustand
│   └── package.json
├── psycho-form/                # Backend y esquema de base de datos
│   ├── psychoform/             # API REST en Java 21 / Spring Boot
│   │   └── src/main/java/com/uam/psychoform/
│   │       ├── academic/       # Catálogos y datos académicos
│   │       ├── assessment/     # Sesiones, aplicación, respuestas e intentos
│   │       ├── audit/          # Auditoría de eventos sensibles
│   │       ├── backup/         # Respaldos del sistema
│   │       ├── instrument/     # Motor de instrumentos, subtests e ítems
│   │       ├── reporting/      # Reportes y estadísticas
│   │       ├── scoring/        # Calificación automática y baremos
│   │       ├── security/       # Autenticación JWT y control de acceso por roles
│   │       └── storage/        # Almacenamiento S3 para imágenes y recursos
│   └── supabase/               # Configuración local de Supabase, PostgreSQL, migraciones y seed
└── AGENTS.md                   # Protocolo de orquestación multiagente del repositorio
```

---

## Stack tecnológico

- **Frontend (`bfa-digital`)**: React 18, TypeScript, Vite, Tailwind CSS, TanStack Router, TanStack Query, Zustand, React Hook Form, Zod, Radix UI y Recharts.
- **Backend (`psycho-form/psychoform`)**: Java 21, Spring Boot 4.1.0 (Web MVC, Data JPA, Security + JWT, Validation, Actuator), Springdoc OpenAPI (Swagger UI) y AWS SDK S3.
- **Base de datos y almacenamiento (`psycho-form/supabase`)**: PostgreSQL 17 y almacenamiento compatible con S3 (Supabase local).

---

## Ejecución en desarrollo local

### Inicio rápido (recomendado)

1. **Instalar dependencias del sistema y del proyecto** (Node.js, `pnpm`, Java 21, Supabase CLI, Docker y paquetes):

```bash
./setup.sh
```

2. **Configurar variables de entorno** (opcional; `setup.sh` crea `.env` y `bfa-digital/.env.local` con valores por defecto):

```bash
./env.sh                  # Menú interactivo
./env.sh list             # Ver variables actuales
./env.sh set CLAVE=VALOR  # Agregar o actualizar una variable (VITE_* va al frontend, el resto al backend)
```

3. **Levantar todo el proyecto** (Supabase/PostgreSQL + S3, Backend Spring Boot y Frontend Vite):

```bash
./dev.sh                  # Levanta BD, Backend y Frontend
./dev.sh status           # Ver estado de los servicios
./dev.sh stop             # Detener Supabase al terminar
```

También puedes usar `make setup`, `make dev`, `make env`, `make status` o `make stop`.

---

### Ejecución manual por servicio

#### 1. Base de datos y almacenamiento (Supabase / PostgreSQL)

El backend espera por defecto una instancia de PostgreSQL en `127.0.0.1:54322` (`postgres`) y almacenamiento S3 en `http://127.0.0.1:54321/storage/v1/s3` (definidos en `psycho-form/psychoform/src/main/resources/application.properties` y configurables mediante variables de entorno `BFA_DB_URL`, `BFA_DB_USERNAME`, `BFA_DB_PASSWORD`, `BFA_JWT_SECRET`, `BFA_STORAGE_S3_*`).

Desde `psycho-form/`:

```bash
cd psycho-form
supabase start
```

#### 2. Backend (Spring Boot)

Desde `psycho-form/psychoform/`:

```bash
cd psycho-form/psychoform
./mvnw spring-boot:run
```

#### 3. Frontend (React + Vite)

Desde `bfa-digital/` (usando `pnpm`):

```bash
cd bfa-digital
pnpm install
pnpm dev
```

### Comandos útiles del frontend

```bash
pnpm build      # Compilar para producción
pnpm typecheck  # Verificar tipos de TypeScript
pnpm lint       # Ejecutar ESLint
pnpm test       # Ejecutar pruebas con Vitest
```

---

## Documentación adicional

- Especificación funcional original de BFA Digital: [`psycho-form/README.md`](psycho-form/README.md)
- Notas del bundle de interfaz web: [`bfa-digital/README.md`](bfa-digital/README.md)
