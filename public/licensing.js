(function () {
  "use strict";
  const api = () => window.posDesktop || {};
  let current = null;
  let banner = null;
  let overlay = null;
  let blocking = false;
  let refreshTimer = null;

  function remaining(ms) {
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const days = Math.floor(hours / 24);
    return days ? days + " d " + (hours % 24) + " h" : hours + " h " + minutes + " min";
  }

  function statusCopy(status) {
    if (!status) return "Consultando estado de licencia…";
    if (status.state === "trial") return "Prueba gratuita de 24 horas · quedan " + remaining(status.remainingMs);
    if (status.state === "licensed") return "Licencia activa · validada con CRM-SICOVEN";
    if (status.state === "licensed_offline") return "Licencia activa en modo sin conexión · margen restante " + remaining(status.offlineRemainingMs);
    if (status.state === "trial_expired") return "La prueba gratuita terminó. Activa una licencia para continuar.";
    if (status.state === "revoked") return status.message || "La licencia fue revocada o no tiene equipos disponibles.";
    if (status.state === "license_expired") return status.message || "La licencia requiere validación en CRM-SICOVEN.";
    if (status.state === "clock_error") return status.message || "Corrige la fecha y hora del equipo.";
    return status.message || status.connectionError || "No se pudo consultar el estado de la licencia.";
  }

  function removeBanner() {
    if (banner) banner.remove();
    banner = null;
  }

  function closePanel() {
    if (overlay && !blocking) overlay.remove();
    if (!blocking) overlay = null;
  }

  function makeButton(label, className, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className || "secondary";
    button.addEventListener("click", action);
    return button;
  }

  async function openPlans() {
    try { await api().licenseOpenPlans(); }
    catch (error) { showError(error && error.message ? error.message : "No se pudo abrir el catálogo de planes."); }
  }

  function showError(message) {
    if (!overlay) return;
    const node = overlay.querySelector(".sifer-license-error");
    if (node) { node.hidden = false; node.textContent = message; }
  }

  function renderPanel(status) {
    current = status || current;
    if (overlay) overlay.remove();
    blocking = !!(current && current.blocked);
    overlay = document.createElement("div");
    overlay.className = "sifer-license-overlay" + (blocking ? " blocking" : "");
    const dialog = document.createElement("section");
    dialog.className = "sifer-license-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", blocking ? "true" : "false");
    const close = makeButton("×", "close", closePanel);
    close.hidden = blocking;
    close.setAttribute("aria-label", "Cerrar");
    dialog.appendChild(close);
    const title = document.createElement("h2");
    title.textContent = "SIFER360 LICORERÍA · Licencia";
    dialog.appendChild(title);
    const state = document.createElement("p");
    state.className = "state";
    state.textContent = statusCopy(current);
    dialog.appendChild(state);
    const description = document.createElement("p");
    if (current && current.state === "trial") {
      description.textContent = "La prueba comienza automáticamente al abrir SIFER360 por primera vez y dura 24 horas. Puedes continuar trabajando o activar un plan desde ahora, sin esperar a que termine.";
    } else if (current && current.state === "licensed_offline") {
      description.textContent = "No hay conexión con CRM-SICOVEN. La licencia permanece habilitada dentro del período offline autorizado por el administrador.";
    } else if (current && current.state === "licensed") {
      description.textContent = "Esta instalación está activada para SIFER360 LICORERÍA. La licencia se verifica con CRM-SICOVEN y permite operar offline durante el margen configurado.";
    } else {
      description.textContent = current && current.message ? current.message : "Para continuar, activa una licencia válida de SIFER360 LICORERÍA.";
    }
    dialog.appendChild(description);

    const label = document.createElement("label");
    label.textContent = "Clave de licencia";
    label.htmlFor = "sifer-license-key";
    dialog.appendChild(label);
    const input = document.createElement("input");
    input.id = "sifer-license-key";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "SIC-XXXXXXXX-XXXXXXXX-XXXXXXXX";
    input.maxLength = 120;
    dialog.appendChild(input);

    const error = document.createElement("p");
    error.className = "error sifer-license-error";
    error.hidden = true;
    dialog.appendChild(error);

    const telemetry = document.createElement("label");
    telemetry.className = "telemetry";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = current ? current.telemetryEnabled !== false : true;
    checkbox.addEventListener("change", async () => {
      try { await api().licenseSetTelemetry(checkbox.checked); }
      catch (e) { showError(e && e.message ? e.message : "No se pudo guardar la preferencia de telemetría."); }
    });
    const telemetryText = document.createElement("span");
    telemetryText.textContent = "Enviar estadísticas técnicas anónimas al CRM: aperturas, versión, prueba y eventos de licencia. No se envían ventas, inventario, caja, clientes ni datos contables.";
    telemetry.append(checkbox, telemetryText);
    dialog.appendChild(telemetry);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(makeButton("Activar licencia", "primary", async () => {
      const key = input.value.trim();
      if (!key) { showError("Introduce la clave que recibiste al adquirir el plan."); input.focus(); return; }
      try {
        const result = await api().licenseActivate(key);
        current = result;
        removeBanner();
        renderPanel(result);
        if (result && !result.blocked) {
          blocking = false;
          closePanel();
          showStatus(result);
        }
      } catch (e) {
        showError(e && e.message ? e.message : "No se pudo activar la licencia. Comprueba la conexión y la clave.");
      }
    }));
    actions.appendChild(makeButton("Ver planes y pagos", "secondary", openPlans));
    if (current && !current.blocked) {
      actions.appendChild(makeButton(current.state === "trial" ? "Continuar con prueba gratuita" : "Continuar", "secondary", () => {
        closePanel();
        if (current.state === "trial") showBanner(current);
      }));
    } else {
      actions.appendChild(makeButton("Volver a comprobar", "secondary", async () => {
        try { const result = await api().licenseRefresh(); showStatus(result); }
        catch (e) { showError(e && e.message ? e.message : "No se pudo validar la licencia."); }
      }));
    }
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    if (blocking) {
      overlay.addEventListener("click", event => { if (event.target === overlay) event.preventDefault(); });
    }
    if (current && current.state === "trial") input.focus();
  }

  function showBanner(status) {
    removeBanner();
    if (!status || status.blocked || !["trial", "licensed_offline"].includes(status.state)) return;
    try { if (sessionStorage.getItem("sifer-license-banner-dismissed") === "1") return; } catch {}
    banner = document.createElement("aside");
    banner.className = "sifer-license-banner";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = status.state === "trial" ? "Prueba gratuita SIFER360" : "Licencia en modo sin conexión";
    const small = document.createElement("small");
    small.textContent = statusCopy(status);
    copy.append(strong, small);
    banner.appendChild(copy);
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    banner.appendChild(spacer);
    banner.appendChild(makeButton("Ver planes", "primary", openPlans));
    banner.appendChild(makeButton("Activar", "quiet", () => renderPanel(current)));
    banner.appendChild(makeButton("×", "quiet", () => {
      try { sessionStorage.setItem("sifer-license-banner-dismissed", "1"); } catch {}
      removeBanner();
    }));
    document.body.appendChild(banner);
  }

  function showStatus(status) {
    current = status;
    if (status && status.blocked) {
      removeBanner();
      renderPanel(status);
      return;
    }
    if (overlay && blocking) { overlay.remove(); overlay = null; blocking = false; }
    if (status && status.state === "licensed") removeBanner();
    else showBanner(status);
  }

  async function refreshStatus() {
    try {
      const local = await api().licenseStatus();
      showStatus(local);
      const checked = await api().licenseRefresh();
      showStatus(checked);
    } catch (error) {
      const fallback = current || { state: "error", blocked: true, message: error && error.message ? error.message : "No se pudo consultar la licencia." };
      showStatus(fallback);
    }
  }

  function open() { renderPanel(current || { state: "trial", blocked: false, telemetryEnabled: true }); }

  document.addEventListener("keydown", event => {
    if (!blocking) return;
    if (overlay && overlay.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.SIFERLicensing = { open, refresh: refreshStatus, status: () => current };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshStatus, { once: true });
  else refreshStatus();
})();
