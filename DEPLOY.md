# Subir la app a Railway (paso a paso)

Resultado al final: una URL como `https://finanzas-tuusuario.up.railway.app` que vas a poder abrir desde cualquier celular o PC, protegida con contraseña, instalable como app en la pantalla del cel.

Tiempo total: **~15 minutos**.

---

## 0. Antes de empezar

Necesitás:
- **Cuenta de GitHub** (gratis): https://github.com/signup
- **Cuenta de Railway** (gratis): https://railway.com (te logueás con GitHub)
- **Git instalado** en tu PC: https://git-scm.com/download/win

---

## 1. Subir el código a un repo de GitHub

Abrí PowerShell **dentro de la carpeta `08-finanzas-node`** (click derecho en la carpeta → "Abrir en Terminal") y pegá:

```powershell
git init
git add .
git commit -m "Primera version"
```

Después andá a https://github.com/new y creá un repositorio:
- **Nombre**: `finanzas` (o el que quieras)
- **Privacidad**: **Private** (importante — tu plata, no la quieras pública)
- No tildes "Add README" ni nada más
- Click en "Create repository"

GitHub te muestra unos comandos. Pegalos en la terminal (los dos primeros, el ejemplo "push an existing repository"):

```powershell
git remote add origin https://github.com/TU-USUARIO/finanzas.git
git branch -M main
git push -u origin main
```

Si te pide login, te abre una ventana del browser para autorizar.

---

## 2. Crear el proyecto en Railway

1. Andá a https://railway.com → "Start a New Project"
2. **Deploy from GitHub repo** → autorizá Railway a leer tus repos si te lo pide
3. Elegí el repo `finanzas` que acabás de subir
4. Railway empieza el deploy automáticamente

Lo va a fallar la primera vez — eso está bien. Te falta configurar algunas cosas.

---

## 3. Configurar variables de entorno

En el dashboard del proyecto en Railway, click en el servicio → pestaña **Variables**:

| Variable | Valor |
|---|---|
| `APP_PASSWORD` | una contraseña que te acuerdes (mínimo 8 caracteres) |
| `SESSION_SECRET` | una cadena random larga (ver abajo cómo generar) |
| `DB_PATH` | `/data/finanzas.db` |

Para generar el `SESSION_SECRET`, en PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copiá el output (será algo como `7f3a8e...`) y pegalo como valor.

---

## 4. Crear un volumen persistente para la DB

**Crítico**: sin esto, cada vez que Railway reinicia tu app perdés todos los datos.

En el dashboard → tu servicio → pestaña **Settings** → buscá la sección **Volumes** → "Create Volume":

- **Mount path**: `/data`
- **Size**: 1 GB (de sobra)

Click en "Add" / "Create".

---

## 5. Generar URL pública

Settings → **Networking** → **Public Networking** → "Generate Domain".

Te da una URL como `finanzas-production-xyz.up.railway.app`. Esa es tu app.

---

## 6. Esperar el redeploy y entrar

Railway redeploya automáticamente cuando cambiás variables o agregás volumen. Andá a la pestaña **Deployments** y esperá a que diga "Success" (~1-2 min).

Abrí la URL → te muestra la pantalla de login → metés tu `APP_PASSWORD` → adentro.

La app está vacía. Para cargar tus datos:

---

## 7. Importar tus gastos del Sheet

Hay dos opciones:

### Opción A: importar via web (futura)

(Por ahora no implementado — usá la opción B.)

### Opción B: cargar la DB local que ya tenés

1. En tu PC, **detené el server local** (cerrá la ventana negra "Finanzas")
2. En Railway, instalá el CLI de Railway (PowerShell):
   ```powershell
   npm install -g @railway/cli
   railway login
   ```
3. Linkeá el proyecto y subí el archivo:
   ```powershell
   cd "C:\Users\joaco\OneDrive\Joaquin\IA\10 SKILLS ADRI Y JUANPE\03-kit-crear-app-multiusuario\08-finanzas-node"
   railway link    # elegí tu proyecto
   railway run --service finanzas bash -c "mkdir -p /data && cat > /data/finanzas.db" < data/finanzas.db
   ```
4. Reiniciá el deploy desde la UI de Railway (botón Restart en Deployments)

> Si esto se complica, decime y te armo un endpoint `/api/import` para subir el `.db` por web.

---

## 8. Instalar la app en tu celular

Abrí la URL en el navegador del cel:

- **iPhone (Safari)**: Compartir → "Añadir a pantalla de inicio"
- **Android (Chrome)**: menú ⋮ → "Instalar app" / "Añadir a pantalla principal"

Aparece como icono ($) y se abre fullscreen, sin barra del navegador. Igual que una app nativa.

---

## 9. Cosas a recordar

- **Backup**: hace `railway run cat /data/finanzas.db > backup.db` cada tanto.
- **Costo**: Railway tiene $5 USD de free credits por mes. Esta app consume centavos. Si te pasás del free tier, te avisa antes de cobrar.
- **Updates**: cada vez que hagas `git push origin main`, Railway redeploya solo.
- **Si te olvidás la contraseña**: cambiala en Variables y redeployá.

---

## Troubleshooting

**"Application failed to respond"** los primeros 30s post-deploy → normal, esperá.

**Login me dice "Contraseña incorrecta" pero la metí bien** → revisá que `APP_PASSWORD` no tenga espacios al final en Railway.

**Veo la app pero no hay datos** → no importaste la DB todavía (paso 7), o el volumen no se creó (paso 4).

**Los datos desaparecen al redeployar** → falta el volumen montado en `/data` (paso 4) o `DB_PATH` apunta a otro lado.
