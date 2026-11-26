## Resumen

Describe brevemente qué cambia este Pull Request y por qué es necesario.

## Tipo de cambio

- [ ] `feat`: Nueva funcionalidad
- [ ] `fix`: Corrección de error
- [ ] `refactor`: Refactorización sin cambio funcional
- [ ] `docs`: Documentación
- [ ] `ci` / `chore`: CI/CD, configuración o mantenimiento

## Área afectada

- [ ] `bfa-digital` (Frontend)
- [ ] `psycho-form/psychoform` (Backend)
- [ ] `psycho-form/supabase` (Migraciones / BD)
- [ ] Otro / Raíz del monorepo

## Checklist antes de solicitar revisión

- [ ] Si tocó frontend: `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build` pasan sin errores.
- [ ] Si tocó backend: `./mvnw test` pasa sin errores.
- [ ] No se incluyeron archivos `.env`, credenciales ni secretos.
- [ ] Los cambios están acotados a una rama descriptiva (`feat/...`, `fix/...`, `chore/...`).
