/*
 * Tema Penumbra: se carga primero en la ventana principal.
 * - Fuerza el modo oscuro.
 * - Si el dispositivo es un teléfono, redirige a la interfaz móvil dedicada
 *   (a menos que el usuario haya elegido "Versión escritorio" desde el móvil).
 */
"use strict";

(() => {
    document.documentElement.classList.add("dark");

    let uiPref = null;
    try {
        uiPref = localStorage.getItem("penumbra.ui");
    }
    catch {}

    const ua = navigator.userAgent || "";
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const smallScreen = Math.min(window.screen.width, window.screen.height) < 600;
    const isPhone = /iPhone|iPod|Windows Phone|Android.+Mobile|Mobile.+Firefox|Mobi/i.test(ua) || (coarse && smallScreen);

    if ((uiPref === "mobile") || ((uiPref !== "desktop") && isPhone))
        window.location.replace("mobile.html");

    // Al volver a la interfaz móvil desde el menú, olvidar la preferencia "escritorio"
    document.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("#mobileUiLink")) {
            try {
                localStorage.removeItem("penumbra.ui");
            }
            catch {}
        }
    }, true);
})();
