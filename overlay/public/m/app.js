/*
 * Penumbra — interfaz móvil dedicada para qBittorrent (WebUI API v2).
 * Sin dependencias. Se comunica con la misma API que usa el WebUI oficial.
 */
"use strict";

(() => {
    // =====================================================================
    // Utilidades
    // =====================================================================
    const STORE_KEY = "penumbra.m";
    const store = {
        data: (() => {
            try {
                return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
            }
            catch {
                return {};
            }
        })(),
        get(k, d) {
            return (k in this.data) ? this.data[k] : d;
        },
        set(k, v) {
            this.data[k] = v;
            try {
                localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
            }
            catch {}
        }
    };

    // Idioma: el de qBittorrent (lo inyecta en <html lang>), o el del navegador si no está disponible
    const htmlLang = document.documentElement.lang || "";
    const LANG = (/^[a-z]{2}$/i.test(htmlLang) ? htmlLang : (navigator.language || "en")).slice(0, 2).toLowerCase();
    const LOCALE = LANG;
    const DICT = (window.PENUMBRA_I18N || {})[LANG] || {};
    // T("English text {0}", value): devuelve la traducción, o el texto en inglés. "§contexto" desambigua claves iguales.
    const T = (s, ...a) => (DICT[s] ?? s.replace(/§.*$/, "")).replace(/\{(\d)\}/g, (m, i) => ((a[i] === undefined) ? m : a[i]));

    const $ = (s, r = document) => r.querySelector(s);
    const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
    const h = (html) => {
        const t = document.createElement("template");
        t.innerHTML = html.trim();
        return t.content.firstElementChild;
    };
    const refs = (root) => {
        const r = { root };
        for (const el of root.querySelectorAll("[data-ref]"))
            r[el.dataset.ref] = el;
        return r;
    };
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const vibrate = (ms = 10) => {
        try {
            navigator.vibrate?.(ms);
        }
        catch {}
    };

    const NF = {};
    const nf = (n, d = 0) => {
        NF[d] ??= new Intl.NumberFormat(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });
        return NF[d].format(n);
    };
    const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    const fmtBytes = (b) => {
        if ((b === undefined) || (b === null) || (b < 0) || Number.isNaN(b))
            return "—";
        let i = 0;
        while ((b >= 1024) && (i < UNITS.length - 1)) {
            b /= 1024;
            i++;
        }
        const d = (i === 0) ? 0 : ((b < 10) ? 2 : ((b < 100) ? 1 : 0));
        return `${nf(b, d)} ${UNITS[i]}`;
    };
    const fmtSpeed = (b) => ((b < 0) ? "—" : `${fmtBytes(b || 0)}/s`);
    const fmtLimit = (b) => ((b > 0) ? fmtSpeed(b) : T("No limit"));
    const fmtPct = (p) => {
        const v = p * 100;
        if (v >= 100)
            return "100%";
        return `${nf(Math.floor(v * 10) / 10, 1)}%`;
    };
    const fmtDur = (s, parts = 2) => {
        if ((s === undefined) || (s === null) || (s < 0))
            return "—";
        if (s >= 8640000)
            return "∞";
        s = Math.round(s);
        const units = [[T("y"), 31536000], ["d", 86400], ["h", 3600], ["min", 60], ["s", 1]];
        const out = [];
        for (const [u, n] of units) {
            if ((s >= n) || ((u === "s") && (out.length === 0))) {
                out.push(`${Math.floor(s / n)} ${u}`);
                s %= n;
            }
            if (out.length >= parts)
                break;
        }
        return out.join(" ");
    };
    const fmtDate = (ts) => {
        if (!ts || (ts < 0) || (ts >= 4294967295))
            return "—";
        return new Date(ts * 1000).toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    const fmtRatio = (r) => (((r === undefined) || (r < 0)) ? "—" : ((r >= 9999) ? "∞" : nf(r, 2)));
    const flag = (cc) => {
        if (!cc || (cc.length !== 2))
            return "🌐";
        return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
    };
    const hostOf = (url) => {
        try {
            return new URL(url).hostname || url;
        }
        catch {
            return url;
        }
    };
    const plainText = (html) => {
        const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
        for (const el of doc.querySelectorAll("script, style, noscript"))
            el.remove();
        return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
    };

    const copyText = async (text, what = T("Copied")) => {
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
        }
        catch {}
        if (!ok) {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
            document.body.append(ta);
            ta.select();
            ta.setSelectionRange(0, text.length);
            try {
                ok = document.execCommand("copy");
            }
            catch {}
            ta.remove();
        }
        toast(ok ? what : T("Could not copy"), ok ? "ok" : "err");
    };

    // =====================================================================
    // Iconos (trazos estilo Lucide)
    // =====================================================================
    const ICONS = {
        play: "<path d='M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z'/>",
        pause: "<path d='M9 5v14M15 5v14' stroke-width='2.8'/>",
        plus: "<path d='M12 5v14M5 12h14'/>",
        trash: "<path d='M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6'/>",
        more: "<circle cx='12' cy='5' r='1.3'/><circle cx='12' cy='12' r='1.3'/><circle cx='12' cy='19' r='1.3'/>",
        search: "<circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/>",
        filter: "<path d='M3 5h18l-7 8.5V19l-4 2v-7.5z'/>",
        sort: "<path d='M3 7h13M3 12h9M3 17h6M17 10v10M14 17l3 3 3-3'/>",
        check: "<path d='M20 6 9 17l-5-5'/>",
        checkAll: "<path d='M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16'/>",
        x: "<path d='M18 6 6 18M6 6l12 12'/>",
        back: "<path d='m15 18-6-6 6-6'/>",
        chev: "<path d='m9 18 6-6-6-6'/>",
        chevDown: "<path d='m6 9 6 6 6-6'/>",
        down: "<path d='M12 4v16M18 14l-6 6-6-6'/>",
        up: "<path d='M12 20V4M6 10l6-6 6 6'/>",
        transfer: "<path d='M7 3v18M3 17l4 4 4-4M17 21V3M13 7l4-4 4 4'/>",
        gauge: "<path d='M12 14l4-4'/><path d='M3.34 19a10 10 0 1 1 17.32 0'/>",
        snail: "<path d='M2 13a6 6 0 1 0 12 0 4 4 0 1 0-8 0 2 2 0 0 0 4 0'/><circle cx='10' cy='13' r='8'/><path d='M2 21h12c4.4 0 8-3.6 8-8V7a2 2 0 1 0-4 0v6M18 3l1.1 2.2M22 3l-1.1 2.2'/>",
        refresh: "<path d='M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5'/>",
        folder: "<path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/>",
        folderMove: "<path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/><path d='m12 10 3 3-3 3M8 13h7'/>",
        file: "<path d='M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z'/><path d='M14 3v6h6'/>",
        tag: "<path d='M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z'/><circle cx='7.5' cy='7.5' r='1.3'/>",
        link: "<path d='M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7'/><path d='M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'/>",
        upload: "<path d='M12 15V3M7 8l5-5 5 5'/><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/>",
        download: "<path d='M12 3v12M7 10l5 5 5-5'/><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/>",
        rss: "<path d='M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16'/><circle cx='5' cy='19' r='1.3'/>",
        settings: "<path d='M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'/>",
        power: "<path d='M12 2v10'/><path d='M18.4 6.6a9 9 0 1 1-12.77.04'/>",
        logout: "<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'/>",
        monitor: "<rect x='2' y='3' width='20' height='14' rx='2'/><path d='M8 21h8M12 17v4'/>",
        magnet: "<path d='m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15M5 8l4 4M12 15l4 4'/>",
        copy: "<rect x='8' y='8' width='14' height='14' rx='2'/><path d='M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2'/>",
        edit: "<path d='M12 20h9'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'/>",
        users: "<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'/>",
        radio: "<circle cx='12' cy='12' r='2'/><path d='M16.2 7.8a6 6 0 0 1 0 8.5M7.8 16.2a6 6 0 0 1 0-8.5M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2'/>",
        info: "<circle cx='12' cy='12' r='10'/><path d='M12 16v-4M12 8h.01'/>",
        zap: "<path d='M13 2 3 14h9l-1 8 10-12h-9z'/>",
        recheck: "<path d='m9 11 3 3L22 4'/><path d='M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'/>",
        megaphone: "<path d='m3 11 18-5v12L3 14z'/><path d='M11.6 16.8a3 3 0 1 1-5.8-1.6'/>",
        scale: "<path d='M12 3v18M7 21h10M3 7h18M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z'/>",
        ordered: "<path d='M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'/>",
        pieces: "<rect x='3' y='3' width='7' height='7' rx='1'/><rect x='14' y='14' width='7' height='7' rx='1'/><path d='M14 3h7v7h-7zM3 14h7v7H3z' opacity='.4'/>",
        sprout: "<path d='M7 20h10M12 20c0-6 0-9 0-11'/><path d='M12 9c0-3-2-5-6-5 0 3 2 5 6 5zM12 12c0-3 2-5 6-5 0 3-2 5-6 5z'/>",
        sparkles: "<path d='M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z'/>",
        queue: "<path d='M3 6h12M3 12h12M3 18h8M19 8v12M16 17l3 3 3-3'/>",
        toTop: "<path d='M5 3h14M18 13l-6-6-6 6M12 7v14'/>",
        toBottom: "<path d='M12 17V3M6 11l6 6 6-6M19 21H5'/>",
        hash: "<path d='M4 9h16M4 15h16M10 3 8 21M16 3l-2 18'/>",
        globe: "<circle cx='12' cy='12' r='10'/><path d='M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/>",
        ban: "<circle cx='12' cy='12' r='10'/><path d='m4.9 4.9 14.2 14.2'/>",
        hdd: "<path d='M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'/><path d='M6 16h.01M10 16h.01'/>",
        wifi: "<path d='M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01'/>",
        wifiOff: "<path d='m2 2 20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M12 20h.01'/>",
        clock: "<circle cx='12' cy='12' r='10'/><path d='M12 6v6l4 2'/>",
        doc: "<path d='M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z'/><path d='M14 3v6h6M8 13h8M8 17h5'/>",
        plug: "<path d='M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z'/>",
        eye: "<path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z'/><circle cx='12' cy='12' r='3'/>",
        layers: "<path d='m12 2 10 5-10 5L2 7z'/><path d='m2 17 10 5 10-5M2 12l10 5 10-5'/>",
        shield: "<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/>",
        activity: "<path d='M22 12h-4l-3 9L9 3l-3 9H2'/>",
        calendar: "<rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/>",
        list: "<path d='M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'/>",
        seed: "<path d='M12 20V10M12 10c0-4 3-6 7-6 0 4-3 6-7 6zM12 13c0-3-2.5-5-6-5 0 3 2.5 5 6 5z'/>"
    };
    const ic = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

    // =====================================================================
    // API
    // =====================================================================
    class HttpError extends Error {
        constructor(status, text) {
            super(text || `HTTP ${status}`);
            this.status = status;
        }
    }

    let onForbidden = () => {};
    const api = {
        async req(path, { method = "GET", params, body } = {}) {
            let url = `api/v2/${path}`;
            const opt = { method, credentials: "same-origin", cache: "no-store" };
            if ((method === "GET") && params)
                url += `?${new URLSearchParams(params)}`;
            else if (body)
                opt.body = body;
            else if (params)
                opt.body = new URLSearchParams(params);
            let r;
            try {
                r = await fetch(url, opt);
            }
            catch (e) {
                throw new HttpError(0, T("No connection"));
            }
            if ((r.status === 403) && !path.startsWith("auth/")) {
                onForbidden();
                throw new HttpError(403, T("Session expired"));
            }
            if (!r.ok) {
                const t = await r.text().catch(() => "");
                throw new HttpError(r.status, t || r.statusText);
            }
            const ct = r.headers.get("content-type") || "";
            return ct.includes("json") ? r.json() : r.text();
        },
        get(p, params) {
            return this.req(p, { params });
        },
        post(p, params = {}) {
            return this.req(p, { method: "POST", params });
        },
        form(p, fd) {
            return this.req(p, { method: "POST", body: fd });
        }
    };

    const run = async (promise, okMsg) => {
        try {
            const r = await promise;
            if (okMsg)
                toast(okMsg, "ok");
            kickSync();
            return r ?? true;
        }
        catch (e) {
            if (e.status !== 403)
                toast(e.message || "Error", "err");
            return null;
        }
    };

    // =====================================================================
    // Estado
    // =====================================================================
    const S = {
        rid: 0,
        torrents: new Map(),
        categories: {},
        tags: [],
        trackers: {},
        server: {},
        prefs: {},
        online: true,
        loaded: false,
        filter: Object.assign({ status: "all", category: null, tag: null, tracker: null }, store.get("filter", {})),
        sort: Object.assign({ key: "added_on", dir: -1 }, store.get("sort", {})),
        q: "",
        sel: new Set(),
        selecting: false,
        tab: store.get("tab", "torrents"),
        version: ""
    };

    const saveFilter = () => store.set("filter", S.filter);

    // =====================================================================
    // Estados de torrent y filtros
    // =====================================================================
    const STATE = {
        downloading: [T("Downloading"), "s-dl"],
        forcedDL: [T("Downloading · forced"), "s-dl"],
        metaDL: [T("Fetching metadata"), "s-dl"],
        forcedMetaDL: [T("Fetching metadata"), "s-dl"],
        stalledDL: [T("Waiting for peers"), "s-stall"],
        uploading: [T("Seeding"), "s-up"],
        forcedUP: [T("Seeding · forced"), "s-up"],
        stalledUP: [T("Seeding · no peers"), "s-stallup"],
        queuedDL: [T("Queued"), "s-queue"],
        queuedUP: [T("Queued · seeding"), "s-queue"],
        checkingDL: [T("Checking"), "s-check"],
        checkingUP: [T("Checking"), "s-check"],
        checkingResumeData: [T("Checking resume data"), "s-check"],
        queuedForChecking: [T("Queued for checking"), "s-check"],
        allocating: [T("Allocating space"), "s-check"],
        moving: [T("Moving"), "s-check"],
        stoppedDL: [T("Stopped"), "s-stop"],
        stoppedUP: [T("Completed"), "s-done"],
        error: ["Error", "s-err"],
        missingFiles: [T("Missing files"), "s-err"],
        unknown: [T("Unknown"), "s-err"]
    };
    const stateOf = (t) => {
        const [label, cls] = STATE[t.state] || [t.state, "s-stop"];
        return { label, cls };
    };
    const isStopped = (t) => String(t.state).startsWith("stopped");

    const STATUS_FILTERS = [
        ["all", T("All")],
        ["downloading", T("Downloading")],
        ["seeding", T("Seeding")],
        ["completed", T("Completed§pl")],
        ["running", T("Running")],
        ["stopped", T("Stopped§pl")],
        ["active", T("Active")],
        ["inactive", T("Inactive")],
        ["stalled", T("Stalled")],
        ["checking", T("Checking")],
        ["moving", T("Moving")],
        ["errored", T("Errored")]
    ];
    const ALWAYS_CHIPS = new Set(["all", "downloading", "seeding", "completed", "stopped", "active"]);

    const matchStatus = (t, f) => {
        const s = t.state;
        switch (f) {
            case "downloading": return (s === "downloading") || s.includes("DL");
            case "seeding": return ["uploading", "forcedUP", "stalledUP", "queuedUP", "checkingUP"].includes(s);
            case "completed": return (s === "uploading") || s.includes("UP");
            case "stopped": return s.includes("stopped");
            case "running": return !s.includes("stopped");
            case "stalled": return (s === "stalledUP") || (s === "stalledDL");
            case "active":
            case "inactive": {
                const active = (s === "stalledDL")
                    ? (t.upspeed > 0)
                    : ["metaDL", "forcedMetaDL", "downloading", "forcedDL", "uploading", "forcedUP"].includes(s);
                return (f === "active") ? active : !active;
            }
            case "checking": return ["checkingUP", "checkingDL", "checkingResumeData"].includes(s);
            case "moving": return s === "moving";
            case "errored": return ["error", "unknown", "missingFiles"].includes(s);
            default: return true;
        }
    };
    const tagsOf = (t) => (t.tags ? t.tags.split(",").map((x) => x.trim()).filter(Boolean) : []);

    let trackerHostMap = new Map(); // host -> Set(hash)
    const rebuildTrackerHosts = () => {
        trackerHostMap = new Map();
        for (const [url, hashes] of Object.entries(S.trackers)) {
            const host = hostOf(url);
            if (!trackerHostMap.has(host))
                trackerHostMap.set(host, new Set());
            const set = trackerHostMap.get(host);
            for (const hh of hashes)
                set.add(hh);
        }
    };

    const matchOthers = (t) => {
        const f = S.filter;
        if (f.category !== null) {
            if (f.category === "") {
                if (t.category)
                    return false;
            }
            else if (S.prefs.use_subcategories) {
                if (!(`${t.category}/`).startsWith(`${f.category}/`))
                    return false;
            }
            else if (t.category !== f.category) {
                return false;
            }
        }
        if (f.tag !== null) {
            const tg = tagsOf(t);
            if ((f.tag === "") ? (tg.length > 0) : !tg.includes(f.tag))
                return false;
        }
        if (f.tracker !== null) {
            if (f.tracker === "") {
                if (t.trackers_count > 0)
                    return false;
            }
            else {
                const set = trackerHostMap.get(f.tracker);
                if (!set || !set.has(t.hash))
                    return false;
            }
        }
        if (S.q) {
            const q = S.q.toLowerCase();
            const terms = q.split(/\s+/).filter(Boolean);
            const name = String(t.name).toLowerCase();
            if (!terms.every((x) => name.includes(x)))
                return false;
        }
        return true;
    };

    const SORTS = [
        ["added_on", T("Added on"), -1],
        ["name", T("Name"), 1],
        ["progress", T("Progress"), -1],
        ["size", T("Size"), -1],
        ["dlspeed", T("Download speed"), -1],
        ["upspeed", T("Upload speed"), -1],
        ["eta", T("Time remaining"), 1],
        ["ratio", "Ratio", -1],
        ["num_seeds", T("Seeds"), -1],
        ["state", T("Status"), 1],
        ["category", T("Category"), 1],
        ["completion_on", T("Completed on"), -1],
        ["last_activity", T("Last activity"), -1],
        ["priority", T("Queue position"), 1]
    ];
    const collator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: "base" });
    const sortTorrents = (list) => {
        const { key, dir } = S.sort;
        list.sort((a, b) => {
            let va = a[key];
            let vb = b[key];
            if (key === "priority") {
                va = (va > 0) ? va : Infinity;
                vb = (vb > 0) ? vb : Infinity;
            }
            let r;
            if ((typeof va === "string") || (typeof vb === "string"))
                r = collator.compare(String(va ?? ""), String(vb ?? ""));
            else
                r = (va ?? 0) - (vb ?? 0);
            if ((r === 0) || Number.isNaN(r))
                r = collator.compare(a.name, b.name);
            return r * dir;
        });
        return list;
    };

    // =====================================================================
    // Sincronización (sync/maindata)
    // =====================================================================
    let syncTimer = null;
    let syncing = false;
    let syncAgain = false;
    const listeners = new Set();
    const onSync = (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    };

    const applyMain = (d) => {
        if (d.full_update) {
            S.torrents.clear();
            S.categories = {};
            S.tags = [];
            S.trackers = {};
        }
        if (d.torrents) {
            for (const [hash, part] of Object.entries(d.torrents)) {
                const cur = S.torrents.get(hash);
                if (cur)
                    Object.assign(cur, part);
                else
                    S.torrents.set(hash, Object.assign({ hash }, part));
            }
        }
        for (const hh of d.torrents_removed || []) {
            S.torrents.delete(hh);
            S.sel.delete(hh);
        }
        if (d.categories) {
            for (const [name, c] of Object.entries(d.categories))
                S.categories[name] = Object.assign(S.categories[name] || {}, c);
        }
        for (const c of d.categories_removed || [])
            delete S.categories[c];
        if (d.tags)
            S.tags = [...new Set([...S.tags, ...d.tags])];
        if (d.tags_removed)
            S.tags = S.tags.filter((x) => !d.tags_removed.includes(x));
        if (d.trackers) {
            for (const [url, hashes] of Object.entries(d.trackers))
                S.trackers[url] = hashes;
        }
        for (const url of d.trackers_removed || [])
            delete S.trackers[url];
        if (d.trackers || d.trackers_removed || d.full_update)
            rebuildTrackerHosts();
        if (d.server_state)
            Object.assign(S.server, d.server_state);
        S.rid = d.rid;
    };

    const sync = async () => {
        clearTimeout(syncTimer);
        if (syncing) {
            syncAgain = true;
            return;
        }
        syncing = true;
        try {
            const d = await api.get("sync/maindata", { rid: S.rid });
            applyMain(d);
            S.online = true;
            S.loaded = true;
        }
        catch (e) {
            if (e.status === 403) {
                syncing = false;
                return;
            }
            S.online = false;
        }
        syncing = false;
        for (const fn of listeners) {
            try {
                fn();
            }
            catch (err) {
                console.error(err);
            }
        }
        const interval = Math.max(1000, Math.min(S.server.refresh_interval || 2000, 5000));
        syncTimer = setTimeout(sync, syncAgain ? 150 : (document.hidden ? 15000 : (S.online ? interval : 4000)));
        syncAgain = false;
    };
    const kickSync = () => {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(sync, 250);
    };
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && S.loaded)
            kickSync();
    });

    const loadPrefs = async () => {
        try {
            S.prefs = await api.get("app/preferences");
        }
        catch {}
    };
    const setPrefs = async (obj, okMsg = T("Saved")) => {
        const r = await run(api.post("app/setPreferences", { json: JSON.stringify(obj) }), okMsg);
        if (r !== null)
            Object.assign(S.prefs, obj);
        return r !== null;
    };

    // =====================================================================
    // Historial (botón "atrás" de Android cierra hojas y páginas)
    // =====================================================================
    const overlays = [];
    let ignorePop = 0;
    let selHistory = false;
    let handoffTimer = null;
    const overlayOpened = (entry) => {
        overlays.push(entry);
        if (handoffTimer) {
            clearTimeout(handoffTimer);
            handoffTimer = null;
            return;
        }
        history.pushState({ penumbra: overlays.length }, "");
    };
    const overlayClosed = (entry, handoff) => {
        const i = overlays.lastIndexOf(entry);
        if (i < 0)
            return;
        overlays.splice(i, 1);
        if (handoff) {
            handoffTimer = setTimeout(() => {
                handoffTimer = null;
                ignorePop++;
                history.back();
            }, 60);
            return;
        }
        ignorePop++;
        history.back();
    };
    window.addEventListener("popstate", () => {
        if (ignorePop > 0) {
            ignorePop--;
            return;
        }
        const entry = overlays.pop();
        if (entry)
            entry.close(true);
        else if (S.selecting) {
            selHistory = false;
            setSelecting(false);
        }
    });

    // =====================================================================
    // Toasts
    // =====================================================================
    const toast = (msg, kind = "") => {
        const el = h(`<div class="toast ${kind}">${ic((kind === "err") ? "info" : "check", "sm")}<span>${esc(msg)}</span></div>`);
        $("#toastRoot").append(el);
        setTimeout(() => {
            el.classList.add("out");
            setTimeout(() => el.remove(), 300);
        }, (kind === "err") ? 3800 : 2200);
    };

    // =====================================================================
    // Hojas inferiores
    // =====================================================================
    const openSheet = ({ title = "", subtitle = "", body = "", onClose, cls = "" } = {}) => {
        const wrap = h(`<div class="sheet-wrap">
            <div class="sheet-backdrop"></div>
            <div class="sheet ${cls}" role="dialog" aria-modal="true">
                <div class="sheet-grip"></div>
                ${title ? `<div class="sheet-head"><div style="flex:1;min-width:0"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="icon-btn plain" data-x aria-label="${T("Close")}">${ic("x")}</button></div>` : ""}
                <div class="sheet-body"></div>
            </div>
        </div>`);
        const bodyEl = wrap.querySelector(".sheet-body");
        if (typeof body === "string")
            bodyEl.innerHTML = body;
        else if (body)
            bodyEl.append(body);
        $("#sheetRoot").append(wrap);
        requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add("open")));

        let closed = false;
        const entry = {
            close: (fromHistory, handoff) => {
                if (closed)
                    return;
                closed = true;
                wrap.classList.remove("open");
                wrap.style.pointerEvents = "none";
                setTimeout(() => wrap.remove(), 320);
                if (!fromHistory)
                    overlayClosed(entry, handoff);
                onClose?.();
            }
        };
        const sheet = {
            el: wrap,
            body: bodyEl,
            close: (opts = {}) => entry.close(false, opts.handoff),
            get closed() {
                return closed;
            }
        };
        wrap.querySelector(".sheet-backdrop").addEventListener("click", () => sheet.close());
        wrap.querySelector("[data-x]")?.addEventListener("click", () => sheet.close());

        // Arrastrar hacia abajo para cerrar
        const sheetEl = wrap.querySelector(".sheet");
        let startY = null;
        let dy = 0;
        const onDown = (e) => {
            startY = e.clientY;
            dy = 0;
            wrap.classList.add("dragging");
            e.currentTarget.setPointerCapture?.(e.pointerId);
        };
        const onMove = (e) => {
            if (startY === null)
                return;
            dy = Math.max(0, e.clientY - startY);
            sheetEl.style.setProperty("--drag", `${dy}px`);
        };
        const onUp = () => {
            if (startY === null)
                return;
            startY = null;
            wrap.classList.remove("dragging");
            sheetEl.style.removeProperty("--drag");
            if (dy > 90)
                sheet.close();
        };
        for (const zone of wrap.querySelectorAll(".sheet-grip, .sheet-head")) {
            zone.addEventListener("pointerdown", (e) => {
                if (e.target.closest("button"))
                    return;
                onDown(e);
            });
            zone.addEventListener("pointermove", onMove);
            zone.addEventListener("pointerup", onUp);
            zone.addEventListener("pointercancel", onUp);
        }
        overlayOpened(entry);
        return sheet;
    };

    // Menú de acciones: items = [{icon, label, sub, danger, value, onClick, hidden, keepOpen}]
    const menuSheet = ({ title, subtitle, items, groups }) => {
        const gs = groups || [{ items }];
        const body = h("<div class=\"menu\"></div>");
        for (const g of gs) {
            const vis = g.items.filter((x) => x && !x.hidden);
            if (!vis.length)
                continue;
            if (g.title)
                body.append(h(`<div class="group-title">${esc(g.title)}</div>`));
            const grp = h("<div class=\"group\"></div>");
            for (const it of vis) {
                const btn = h(`<button class="item ${it.danger ? "danger" : ""}">
                    ${it.icon ? ic(it.icon) : ""}
                    <span class="lbl">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span>
                    ${(it.value === true) ? `<span class="val">${ic("check")}</span>` : ((typeof it.value === "string") ? `<span class="val">${esc(it.value)}</span>` : "")}
                    ${it.chev ? `<span class="chev">${ic("chev", "sm")}</span>` : ""}
                </button>`);
                btn.addEventListener("click", () => {
                    if (!it.keepOpen)
                        sheet.close({ handoff: true });
                    it.onClick?.();
                });
                grp.append(btn);
            }
            body.append(grp);
        }
        const sheet = openSheet({ title, subtitle, body });
        return sheet;
    };

    const confirmSheet = ({ title, message = "", ok = T("OK"), danger = false, check = null }) => new Promise((resolve) => {
        let result = false;
        const body = h(`<div>
            ${message ? `<p style="color:var(--text-dim);margin:0 2px 16px;overflow-wrap:anywhere">${esc(message)}</p>` : ""}
            ${check ? `<div class="group"><label class="item"><span class="lbl">${esc(check.label)}${check.sub ? `<small>${esc(check.sub)}</small>` : ""}</span><span class="switch"><input type="checkbox" data-ref="cb" ${check.value ? "checked" : ""}><i></i></span></label></div>` : ""}
            <div class="btns"><button class="btn" data-ref="no">${T("Cancel")}</button><button class="btn ${danger ? "danger" : "primary"}" data-ref="yes">${esc(ok)}</button></div>
        </div>`);
        const r = refs(body);
        const sheet = openSheet({
            title,
            body,
            onClose: () => resolve(result)
        });
        r.no.addEventListener("click", () => sheet.close());
        r.yes.addEventListener("click", () => {
            result = check ? { checked: r.cb.checked } : true;
            sheet.close();
        });
    });

    const promptSheet = ({ title, label = "", value = "", placeholder = "", type = "text", hint = "", ok = T("Save"), multiline = false, inputmode = "" }) => new Promise((resolve) => {
        let result = null;
        const body = h(`<form>
            <div class="field">
                ${label ? `<label>${esc(label)}</label>` : ""}
                ${multiline
                    ? `<textarea data-ref="inp" placeholder="${esc(placeholder)}" autocapitalize="none" autocorrect="off" spellcheck="false"></textarea>`
                    : `<input data-ref="inp" type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ""} placeholder="${esc(placeholder)}" autocapitalize="none" autocorrect="off" spellcheck="false" ${(type === "number") ? "step=\"any\"" : ""}>`}
                ${hint ? `<div class="hint">${esc(hint)}</div>` : ""}
            </div>
            <div class="btns"><button type="button" class="btn" data-ref="no">${T("Cancel")}</button><button type="submit" class="btn primary">${esc(ok)}</button></div>
        </form>`);
        const r = refs(body);
        r.inp.value = value;
        const sheet = openSheet({ title, body, onClose: () => resolve(result) });
        r.no.addEventListener("click", () => sheet.close());
        body.addEventListener("submit", (e) => {
            e.preventDefault();
            result = r.inp.value;
            sheet.close();
        });
        setTimeout(() => {
            r.inp.focus();
            if (r.inp.select && value)
                r.inp.select();
        }, 320);
    });

    // opciones: [{value, label, sub, icon}]
    const choiceSheet = ({ title, subtitle, options, selected }) => new Promise((resolve) => {
        let result;
        const body = h("<div class=\"group optlist\"></div>");
        const sheet = openSheet({ title, subtitle, body, onClose: () => resolve(result) });
        for (const o of options) {
            const b = h(`<button class="item">${o.icon ? `<span class="ico ${o.iconCls || ""}">${ic(o.icon, "sm")}</span>` : ""}<span class="lbl">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</span><span class="radio ${(o.value === selected) ? "on" : ""}"></span></button>`);
            b.addEventListener("click", () => {
                result = o.value;
                sheet.close({ handoff: !!o.handoff });
            });
            body.append(b);
        }
    });

    // =====================================================================
    // Páginas a pantalla completa (detalle, listas)
    // =====================================================================
    const openPage = ({ title, actions = "", onClose }) => {
        const el = h(`<div class="page">
            <header class="topbar"><div class="topbar-row">
                <button class="icon-btn" data-ref="back" aria-label="${T("Back")}">${ic("back")}</button>
                <h1 data-ref="title">${esc(title)}</h1>
                <span data-ref="actions" style="display:flex;gap:8px">${actions}</span>
            </div></header>
            <div class="main" data-ref="main"></div>
        </div>`);
        const r = refs(el);
        document.body.append(el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("open")));
        r.main.addEventListener("scroll", () => el.classList.toggle("scrolled", r.main.scrollTop > 4), { passive: true });
        let closed = false;
        const entry = {
            close: (fromHistory) => {
                if (closed)
                    return;
                closed = true;
                el.classList.remove("open");
                setTimeout(() => el.remove(), 320);
                if (!fromHistory)
                    overlayClosed(entry);
                onClose?.();
            }
        };
        r.back.addEventListener("click", () => entry.close(false));
        overlayOpened(entry);
        return {
            el,
            r,
            close: () => entry.close(false),
            get closed() {
                return closed;
            }
        };
    };

    // Render con claves: reutiliza los nodos existentes para no perder toques ni scroll
    const keyed = (container, items, keyFn, create, update) => {
        const old = container._k || new Map();
        const next = new Map();
        let i = 0;
        for (const it of items) {
            const k = keyFn(it);
            let el = old.get(k);
            if (!el)
                el = create(it, k);
            update(el, it);
            next.set(k, el);
            const cur = container.children[i];
            if (cur !== el)
                container.insertBefore(el, cur || null);
            i++;
        }
        for (const [k, el] of old) {
            if (!next.has(k))
                el.remove();
        }
        container._k = next;
    };

    // Pulsación larga + toque sobre un contenedor delegado
    const pressable = (container, selector, { onTap, onLong }) => {
        let timer = null;
        let startX = 0;
        let startY = 0;
        let target = null;
        let longFired = false;
        const cancel = () => {
            clearTimeout(timer);
            timer = null;
        };
        container.addEventListener("pointerdown", (e) => {
            const el = e.target.closest(selector);
            if (!el || e.target.closest("[data-nolong]"))
                return;
            target = el;
            longFired = false;
            startX = e.clientX;
            startY = e.clientY;
            cancel();
            if (onLong) {
                timer = setTimeout(() => {
                    longFired = true;
                    vibrate(12);
                    onLong(target, e);
                }, 480);
            }
        });
        container.addEventListener("pointermove", (e) => {
            if (timer && ((Math.abs(e.clientX - startX) > 10) || (Math.abs(e.clientY - startY) > 10)))
                cancel();
        }, { passive: true });
        container.addEventListener("pointerup", cancel);
        container.addEventListener("pointercancel", cancel);
        container.addEventListener("contextmenu", (e) => {
            if (e.target.closest(selector))
                e.preventDefault();
        });
        container.addEventListener("click", (e) => {
            const el = e.target.closest(selector);
            if (!el)
                return;
            if (longFired) {
                longFired = false;
                return;
            }
            onTap?.(el, e);
        });
    };

    // =====================================================================
    // Acciones sobre torrents
    // =====================================================================
    const J = (hashes) => hashes.join("|");
    const tor = (hash) => S.torrents.get(hash);
    const nameOf = (hashes) => ((hashes.length === 1) ? (tor(hashes[0])?.name || "") : `${hashes.length} torrents`);

    const actions = {
        start: (hs) => run(api.post("torrents/start", { hashes: J(hs) }), (hs.length > 1) ? T("Started§pl") : T("Started")),
        stop: (hs) => run(api.post("torrents/stop", { hashes: J(hs) }), (hs.length > 1) ? T("Stopped§pl") : T("Stopped")),
        toggle: (hs) => {
            const t = tor(hs[0]);
            return (t && isStopped(t)) ? actions.start(hs) : actions.stop(hs);
        },
        forceStart: (hs) => {
            const on = hs.every((x) => tor(x)?.force_start);
            return run(api.post("torrents/setForceStart", { hashes: J(hs), value: String(!on) }), on ? T("Force start off") : T("Force start"));
        },
        recheck: async (hs) => {
            if (await confirmSheet({ title: T("Recheck?"), message: T("The data of {0} will be verified.", nameOf(hs)), ok: T("Check") }))
                run(api.post("torrents/recheck", { hashes: J(hs) }), T("Recheck started"));
        },
        reannounce: (hs) => run(api.post("torrents/reannounce", { hashes: J(hs) }), T("Reannounced to trackers")),
        delete: async (hs, after) => {
            const res = await confirmSheet({
                title: (hs.length > 1) ? T("Delete {0} torrents?", hs.length) : T("Delete torrent?"),
                message: nameOf(hs),
                ok: T("Delete"),
                danger: true,
                check: { label: T("Also delete the files"), sub: T("Removes the downloaded data from disk"), value: store.get("deleteFiles", false) }
            });
            if (!res)
                return;
            store.set("deleteFiles", res.checked);
            const ok = await run(api.post("torrents/delete", { hashes: J(hs), deleteFiles: String(res.checked) }), res.checked ? T("Torrent and files deleted") : T("Torrent deleted"));
            if (ok !== null) {
                for (const x of hs)
                    S.sel.delete(x);
                after?.();
            }
        },
        location: async (hs) => {
            const cur = tor(hs[0])?.save_path || S.prefs.save_path || "";
            const v = await promptSheet({ title: T("Set location"), label: T("New save path"), value: cur, hint: T("The files will be moved to this folder."), ok: T("Move") });
            if (v && v.trim())
                run(api.post("torrents/setLocation", { hashes: J(hs), location: v.trim() }), T("Moving files…"));
        },
        rename: async (hs) => {
            const t = tor(hs[0]);
            const v = await promptSheet({ title: T("Rename torrent"), label: T("Name"), value: t?.name || "" });
            if (v && v.trim())
                run(api.post("torrents/rename", { hash: hs[0], name: v.trim() }), T("Renamed"));
        },
        category: async (hs) => {
            const cur = (hs.length === 1) ? (tor(hs[0])?.category ?? "") : undefined;
            const opts = [{ value: "", label: T("No category"), icon: "x" }];
            for (const name of Object.keys(S.categories).sort(collator.compare))
                opts.push({ value: name, label: name, sub: S.categories[name].savePath || "", icon: "folder", iconCls: "accent" });
            opts.push({ value: "\u0000new", label: T("New category…"), icon: "plus", handoff: true });
            const v = await choiceSheet({ title: T("Category"), subtitle: nameOf(hs), options: opts, selected: cur });
            if (v === undefined)
                return;
            if (v === "\u0000new") {
                const name = await categoryEditor();
                if (name)
                    run(api.post("torrents/setCategory", { hashes: J(hs), category: name }), T("Category set"));
                return;
            }
            run(api.post("torrents/setCategory", { hashes: J(hs), category: v }), v ? T("Category set") : T("Category cleared"));
        },
        tags: (hs) => {
            const counts = new Map();
            for (const x of hs) {
                for (const tg of tagsOf(tor(x) || {}))
                    counts.set(tg, (counts.get(tg) || 0) + 1);
            }
            const body = h(`<div>
                <div class="group" data-ref="list"></div>
                <div class="btns"><button class="btn" data-ref="add">${ic("plus", "sm")} ${T("New tag")}</button></div>
            </div>`);
            const r = refs(body);
            const sheet = openSheet({ title: T("Tags"), subtitle: nameOf(hs), body });
            const render = () => {
                r.list.innerHTML = "";
                const all = [...S.tags].sort(collator.compare);
                if (!all.length)
                    r.list.innerHTML = "<div class=\"item\"><span class=\"lbl\" style=\"color:var(--text-faint)\">" + T("No tags yet") + "</span></div>";
                for (const tg of all) {
                    const n = counts.get(tg) || 0;
                    const state = (n === hs.length) ? "on" : "";
                    const b = h(`<button class="item"><span class="ico">${ic("tag", "sm")}</span><span class="lbl">${esc(tg)}${(n && (n < hs.length)) ? `<small>${T("In {0} of {1}", n, hs.length)}</small>` : ""}</span><span class="boxcheck ${state}">${ic("check", "xs")}</span></button>`);
                    b.addEventListener("click", async () => {
                        const has = (counts.get(tg) || 0) === hs.length;
                        const ok = await run(api.post(has ? "torrents/removeTags" : "torrents/addTags", { hashes: J(hs), tags: tg }));
                        if (ok !== null) {
                            counts.set(tg, has ? 0 : hs.length);
                            render();
                        }
                    });
                    r.list.append(b);
                }
            };
            render();
            r.add.addEventListener("click", async () => {
                sheet.close({ handoff: true });
                const v = await promptSheet({ title: T("New tag"), label: T("Tag name"), ok: T("Create and assign") });
                if (v && v.trim()) {
                    const tg = v.trim();
                    await run(api.post("torrents/createTags", { tags: tg }));
                    run(api.post("torrents/addTags", { hashes: J(hs), tags: tg }), T("Tag added"));
                }
            });
        },
        autoTMM: (hs) => {
            const on = hs.every((x) => tor(x)?.auto_tmm);
            return run(api.post("torrents/setAutoManagement", { hashes: J(hs), enable: String(!on) }), on ? T("Automatic management off") : T("Automatic management on"));
        },
        speedLimit: async (hs, dir) => {
            const key = (dir === "dl") ? "dl_limit" : "up_limit";
            const cur = (hs.length === 1) ? (tor(hs[0])?.[key] || 0) : 0;
            const v = await promptSheet({
                title: (dir === "dl") ? T("Download limit") : T("Upload limit"),
                label: T("KiB/s (0 = unlimited)"),
                value: (cur > 0) ? String(Math.round(cur / 1024)) : "0",
                type: "number",
                inputmode: "numeric"
            });
            if (v === null)
                return;
            const n = Math.max(0, Number(v) || 0);
            run(api.post((dir === "dl") ? "torrents/setDownloadLimit" : "torrents/setUploadLimit", { hashes: J(hs), limit: Math.round(n * 1024) }), n ? T("Limit: {0}", fmtSpeed(n * 1024)) : T("No limit"));
        },
        shareLimits: (hs) => {
            const t = tor(hs[0]) || {};
            const mode = (v) => ((v === -2) ? "global" : ((v === -1) ? "none" : "custom"));
            const body = h(`<form>
                <div class="field"><label>Ratio</label><select data-ref="rm"><option value="global">${T("Use global limit")}</option><option value="none">${T("No limit")}</option><option value="custom">${T("Custom")}</option></select></div>
                <div class="field" data-ref="rvF"><input type="number" step="0.01" min="0" data-ref="rv" inputmode="decimal" placeholder="${T("e.g. {0}", 2)}"></div>
                <div class="field"><label>${T("Seeding time (minutes)")}</label><select data-ref="sm"><option value="global">${T("Use global limit")}</option><option value="none">${T("No limit")}</option><option value="custom">${T("Custom")}</option></select></div>
                <div class="field" data-ref="svF"><input type="number" min="0" data-ref="sv" inputmode="numeric" placeholder="${T("e.g. {0}", 1440)}"></div>
                <div class="field"><label>${T("Inactive seeding time (minutes)")}</label><select data-ref="im"><option value="global">${T("Use global limit")}</option><option value="none">${T("No limit")}</option><option value="custom">${T("Custom")}</option></select></div>
                <div class="field" data-ref="ivF"><input type="number" min="0" data-ref="iv" inputmode="numeric" placeholder="${T("e.g. {0}", 60)}"></div>
                <div class="btns"><button type="button" class="btn" data-ref="no">${T("Cancel")}</button><button class="btn primary">${T("Save")}</button></div>
            </form>`);
            const r = refs(body);
            r.rm.value = mode(t.ratio_limit ?? -2);
            r.rv.value = (t.ratio_limit >= 0) ? t.ratio_limit : "";
            r.sm.value = mode(t.seeding_time_limit ?? -2);
            r.sv.value = (t.seeding_time_limit >= 0) ? t.seeding_time_limit : "";
            r.im.value = mode(t.inactive_seeding_time_limit ?? -2);
            r.iv.value = (t.inactive_seeding_time_limit >= 0) ? t.inactive_seeding_time_limit : "";
            const sync2 = () => {
                r.rvF.classList.toggle("hidden", r.rm.value !== "custom");
                r.svF.classList.toggle("hidden", r.sm.value !== "custom");
                r.ivF.classList.toggle("hidden", r.im.value !== "custom");
            };
            for (const s of [r.rm, r.sm, r.im])
                s.addEventListener("change", sync2);
            sync2();
            const sheet = openSheet({ title: T("Share limits"), subtitle: nameOf(hs), body });
            r.no.addEventListener("click", () => sheet.close());
            const val = (m, v) => ((m === "global") ? -2 : ((m === "none") ? -1 : Math.max(0, Number(v) || 0)));
            body.addEventListener("submit", (e) => {
                e.preventDefault();
                run(api.post("torrents/setShareLimits", {
                    hashes: J(hs),
                    ratioLimit: val(r.rm.value, r.rv.value),
                    seedingTimeLimit: Math.round(val(r.sm.value, r.sv.value)),
                    inactiveSeedingTimeLimit: Math.round(val(r.im.value, r.iv.value))
                }), T("Limits saved"));
                sheet.close();
            });
        },
        // Para varios torrents, alinea todos al estado contrario del primero
        toggleFlag: (hs, field, endpoint, msgOn, msgOff) => {
            const target = !hs.every((x) => tor(x)?.[field]);
            const todo = hs.filter((x) => !!tor(x)?.[field] !== target);
            if (!todo.length)
                return;
            return run(api.post(endpoint, { hashes: J(todo) }), target ? msgOn : msgOff);
        },
        sequential: (hs) => actions.toggleFlag(hs, "seq_dl", "torrents/toggleSequentialDownload", T("Sequential download on"), T("Sequential download off")),
        firstLast: (hs) => actions.toggleFlag(hs, "f_l_piece_prio", "torrents/toggleFirstLastPiecePrio", T("First and last pieces first"), T("Normal piece priority")),
        superSeeding: (hs) => {
            const on = hs.every((x) => tor(x)?.super_seeding);
            return run(api.post("torrents/setSuperSeeding", { hashes: J(hs), value: String(!on) }), on ? T("Super seeding off") : T("Super seeding on"));
        },
        queue: (hs, where) => run(api.post(`torrents/${where}`, { hashes: J(hs) }), T("Queue updated")),
        exportTorrent: async (hs) => {
            for (const hash of hs) {
                try {
                    const r = await fetch("api/v2/torrents/export", { method: "POST", body: new URLSearchParams({ hash }) });
                    if (!r.ok)
                        throw new Error(await r.text());
                    const blob = await r.blob();
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${(tor(hash)?.name || hash).replace(/[\\/:*?"<>|]/g, "_")}.torrent`;
                    document.body.append(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                }
                catch (e) {
                    toast(T("Could not export: {0}", e.message), "err");
                }
            }
        }
    };

    const moreMenu = (hs, { after } = {}) => {
        const one = hs.length === 1;
        const t = tor(hs[0]) || {};
        const all = (f) => hs.every((x) => tor(x)?.[f]);
        const queueing = S.server.queueing ?? S.prefs.queueing_enabled;
        const anyComplete = hs.some((x) => (tor(x)?.progress ?? 0) >= 1);
        const anyIncomplete = hs.some((x) => (tor(x)?.progress ?? 1) < 1);
        menuSheet({
            title: one ? t.name : `${hs.length} torrents`,
            subtitle: one ? stateOf(t).label : T("Actions for the selection"),
            groups: [
                {
                    items: [
                        { icon: "play", label: T("Start"), onClick: () => actions.start(hs), hidden: one && !isStopped(t) },
                        { icon: "pause", label: T("Stop"), onClick: () => actions.stop(hs), hidden: one && isStopped(t) },
                        { icon: "zap", label: T("Force start"), value: all("force_start"), onClick: () => actions.forceStart(hs) }
                    ]
                },
                {
                    title: T("Organize"),
                    items: [
                        { icon: "folder", label: T("Category"), value: one ? (t.category || T("None")) : undefined, onClick: () => actions.category(hs) },
                        { icon: "tag", label: T("Tags"), value: one ? (tagsOf(t).length ? String(tagsOf(t).length) : "") : undefined, onClick: () => actions.tags(hs) },
                        { icon: "folderMove", label: T("Set location…"), onClick: () => actions.location(hs) },
                        { icon: "edit", label: T("Rename…"), hidden: !one, onClick: () => actions.rename(hs) },
                        { icon: "sparkles", label: T("Automatic management"), sub: T("The category decides the save path"), value: all("auto_tmm"), onClick: () => actions.autoTMM(hs) }
                    ]
                },
                {
                    title: T("Speed and seeding"),
                    items: [
                        { icon: "down", label: T("Download limit…"), value: one ? fmtLimit(t.dl_limit) : undefined, onClick: () => actions.speedLimit(hs, "dl") },
                        { icon: "up", label: T("Upload limit…"), value: one ? fmtLimit(t.up_limit) : undefined, onClick: () => actions.speedLimit(hs, "up") },
                        { icon: "scale", label: T("Share limits…"), onClick: () => actions.shareLimits(hs) },
                        { icon: "seed", label: T("Super seeding"), value: all("super_seeding"), hidden: !anyComplete, onClick: () => actions.superSeeding(hs) }
                    ]
                },
                {
                    title: T("Download"),
                    items: [
                        { icon: "ordered", label: T("Sequential download"), value: all("seq_dl"), hidden: !anyIncomplete, onClick: () => actions.sequential(hs) },
                        { icon: "pieces", label: T("First and last pieces first"), value: all("f_l_piece_prio"), hidden: !anyIncomplete, onClick: () => actions.firstLast(hs) },
                        { icon: "recheck", label: T("Force recheck"), onClick: () => actions.recheck(hs) },
                        { icon: "megaphone", label: T("Force reannounce"), onClick: () => actions.reannounce(hs) }
                    ]
                },
                {
                    title: T("Queue"),
                    items: queueing
                        ? [
                            { icon: "toTop", label: T("Move to top"), onClick: () => actions.queue(hs, "topPrio") },
                            { icon: "up", label: T("Move up"), onClick: () => actions.queue(hs, "increasePrio") },
                            { icon: "down", label: T("Move down"), onClick: () => actions.queue(hs, "decreasePrio") },
                            { icon: "toBottom", label: T("Move to bottom"), onClick: () => actions.queue(hs, "bottomPrio") }
                        ]
                        : []
                },
                {
                    title: T("Copy and export"),
                    items: [
                        { icon: "copy", label: T("Copy name"), onClick: () => copyText(hs.map((x) => tor(x)?.name).join("\n"), T("Name copied")) },
                        { icon: "magnet", label: T("Copy magnet link"), onClick: () => copyText(hs.map((x) => tor(x)?.magnet_uri).join("\n"), T("Magnet link copied")) },
                        { icon: "hash", label: T("Copy hash"), onClick: () => copyText(hs.map((x) => tor(x)?.infohash_v1 || x).join("\n"), T("Hash copied")) },
                        { icon: "download", label: T("Export .torrent"), onClick: () => actions.exportTorrent(hs) }
                    ]
                },
                {
                    items: [
                        { icon: "trash", label: T("Delete…"), danger: true, onClick: () => actions.delete(hs, after) }
                    ]
                }
            ]
        });
    };

    // =====================================================================
    // Categorías y etiquetas
    // =====================================================================
    const categoryEditor = (existing) => new Promise((resolve) => {
        let result = null;
        const body = h(`<form>
            <div class="field"><label>${T("Name")}</label><input type="text" data-ref="name" placeholder="${T("Movies")}" autocapitalize="none" ${existing ? "disabled" : ""}></div>
            <div class="field"><label>${T("Save path")}</label><input type="text" data-ref="path" placeholder="${esc(S.prefs.save_path || T("/path/to/downloads"))}" autocapitalize="none" autocorrect="off" spellcheck="false"><div class="hint">${T("Leave empty to use the default path.")}</div></div>
            <div class="btns"><button type="button" class="btn" data-ref="no">${T("Cancel")}</button><button class="btn primary">${existing ? T("Save") : T("Create")}</button></div>
        </form>`);
        const r = refs(body);
        if (existing) {
            r.name.value = existing;
            r.path.value = S.categories[existing]?.savePath || "";
        }
        const sheet = openSheet({ title: existing ? T("Edit category") : T("New category"), body, onClose: () => resolve(result) });
        r.no.addEventListener("click", () => sheet.close());
        body.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = r.name.value.trim();
            if (!name)
                return r.name.focus();
            const ok = await run(api.post(existing ? "torrents/editCategory" : "torrents/createCategory", { category: name, savePath: r.path.value.trim() }), existing ? T("Category saved") : T("Category created"));
            if (ok !== null) {
                S.categories[name] = Object.assign(S.categories[name] || { name }, { savePath: r.path.value.trim() });
                result = name;
                sheet.close();
            }
        });
        if (!existing)
            setTimeout(() => r.name.focus(), 320);
    });

    // =====================================================================
    // Agregar torrents
    // =====================================================================
    const addSheet = ({ url = "" } = {}) => {
        const p = S.prefs;
        const cats = Object.keys(S.categories).sort(collator.compare);
        const body = h(`<form>
            <div class="seg" style="position:static;margin-top:0">
                <button type="button" data-mode="link" class="active">${ic("link", "sm")} ${T("Link")}</button>
                <button type="button" data-mode="file">${ic("file", "sm")} ${T("Torrent file")}</button>
            </div>
            <div class="field" data-ref="linkF">
                <textarea data-ref="urls" placeholder="magnet:?xt=urn:btih:…&#10;https://…/${T("file.torrent")}&#10;${T("(one per line)")}" autocapitalize="none" autocorrect="off" spellcheck="false"></textarea>
                <div class="hint">${T("Magnet links, HTTP URLs or hashes. One per line.")}</div>
            </div>
            <div class="field hidden" data-ref="fileF">
                <label class="filepick" data-ref="pick">${ic("upload")}<b data-ref="pickTxt">${T("Choose .torrent files")}</b><small>${T("You can select several")}</small>
                    <input type="file" data-ref="files" accept=".torrent,application/x-bittorrent" multiple hidden>
                </label>
            </div>
            <div class="row2">
                <div class="field"><label>${T("Category")}</label><select data-ref="cat"><option value="">${T("No category")}</option>${cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div>
                <div class="field"><label>${T("Layout")}</label><select data-ref="layout"><option value="Original">Original</option><option value="Subfolder">${T("Create subfolder§add")}</option><option value="NoSubfolder">${T("Don't create subfolder")}</option></select></div>
            </div>
            <div class="field" data-ref="tagsF"><span class="flabel">${T("Tags")}</span><div class="chips" data-ref="tags" style="margin:0;padding:0;flex-wrap:wrap"></div></div>
            <div class="field" data-ref="pathF"><label>${T("Save to")}</label><input type="text" data-ref="path" autocapitalize="none" autocorrect="off" spellcheck="false"></div>
            <div class="group toggles">
                <label class="item"><span class="lbl">${T("Start torrent")}</span><span class="switch"><input type="checkbox" data-ref="start"><i></i></span></label>
                <label class="item"><span class="lbl">${T("Automatic management")}<small>${T("The category sets the path")}</small></span><span class="switch"><input type="checkbox" data-ref="tmm"><i></i></span></label>
                <label class="item"><span class="lbl">${T("Sequential download")}</span><span class="switch"><input type="checkbox" data-ref="seq"><i></i></span></label>
                <label class="item"><span class="lbl">${T("First and last pieces first")}</span><span class="switch"><input type="checkbox" data-ref="fl"><i></i></span></label>
                <label class="item"><span class="lbl">${T("Skip hash check")}</span><span class="switch"><input type="checkbox" data-ref="skip"><i></i></span></label>
                <label class="item"><span class="lbl">${T("Add to top of queue")}</span><span class="switch"><input type="checkbox" data-ref="top"><i></i></span></label>
            </div>
            <details class="group" style="padding:0 14px" data-ref="adv">
                <summary class="item" style="padding:12px 0;list-style:none"><span class="lbl">${T("More options")}</span>${ic("chevDown", "sm")}</summary>
                <div style="padding-bottom:8px">
                    <div class="field"><label>${T("Rename torrent")}</label><input type="text" data-ref="rename" placeholder="${T("Optional")}"></div>
                    <div class="row2">
                        <div class="field"><label>${T("Limit ↓ KiB/s")}</label><input type="number" min="0" inputmode="numeric" data-ref="dl" placeholder="0"></div>
                        <div class="field"><label>${T("Limit ↑ KiB/s")}</label><input type="number" min="0" inputmode="numeric" data-ref="ul" placeholder="0"></div>
                    </div>
                </div>
            </details>
            <button class="btn primary" data-ref="submit">${ic("plus", "sm")} ${T("Add")}</button>
        </form>`);
        const r = refs(body);
        let mode = "link";
        const chosenTags = new Set();
        r.urls.value = url;
        r.path.value = p.save_path || "";
        r.layout.value = p.torrent_content_layout || "Original";
        r.start.checked = !p.add_stopped_enabled;
        r.tmm.checked = !!p.auto_tmm_enabled;
        r.top.checked = !!p.add_to_top_of_queue;

        const syncPath = () => {
            r.pathF.classList.toggle("hidden", r.tmm.checked);
        };
        r.tmm.addEventListener("change", syncPath);
        syncPath();
        r.cat.addEventListener("change", () => {
            const c = S.categories[r.cat.value];
            if (c?.savePath && !r.tmm.checked)
                r.path.value = c.savePath;
        });
        const renderTags = () => {
            r.tags.innerHTML = "";
            for (const tg of [...S.tags].sort(collator.compare)) {
                const b = h(`<button type="button" class="chip ${chosenTags.has(tg) ? "soft" : ""}">${chosenTags.has(tg) ? ic("check", "xs") : ""}${esc(tg)}</button>`);
                b.addEventListener("click", () => {
                    if (chosenTags.has(tg))
                        chosenTags.delete(tg);
                    else
                        chosenTags.add(tg);
                    renderTags();
                });
                r.tags.append(b);
            }
            if (!S.tags.length)
                r.tagsF.classList.add("hidden");
        };
        renderTags();
        for (const b of body.querySelectorAll("[data-mode]")) {
            b.addEventListener("click", () => {
                mode = b.dataset.mode;
                for (const x of body.querySelectorAll("[data-mode]"))
                    x.classList.toggle("active", x === b);
                r.linkF.classList.toggle("hidden", mode !== "link");
                r.fileF.classList.toggle("hidden", mode !== "file");
            });
        }
        r.files.addEventListener("change", () => {
            const n = r.files.files.length;
            r.pick.classList.toggle("has", n > 0);
            r.pickTxt.textContent = n ? ((n === 1) ? r.files.files[0].name : T("{0} files selected", n)) : T("Choose .torrent files");
        });

        const sheet = openSheet({ title: T("Add torrent"), body });
        body.addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData();
            if (mode === "link") {
                const urls = r.urls.value.split("\n").map((x) => x.trim()).filter(Boolean);
                if (!urls.length) {
                    toast(T("Paste at least one link"), "err");
                    return r.urls.focus();
                }
                fd.append("urls", urls.join("\n"));
            }
            else {
                if (!r.files.files.length) {
                    toast(T("Choose at least one .torrent file"), "err");
                    return;
                }
                for (const f of r.files.files)
                    fd.append("torrents", f, f.name);
            }
            if (!r.tmm.checked && r.path.value.trim())
                fd.append("savepath", r.path.value.trim());
            if (r.cat.value)
                fd.append("category", r.cat.value);
            if (chosenTags.size)
                fd.append("tags", [...chosenTags].join(","));
            if (r.rename.value.trim())
                fd.append("rename", r.rename.value.trim());
            fd.append("stopped", String(!r.start.checked));
            fd.append("autoTMM", String(r.tmm.checked));
            fd.append("sequentialDownload", String(r.seq.checked));
            fd.append("firstLastPiecePrio", String(r.fl.checked));
            fd.append("skip_checking", String(r.skip.checked));
            fd.append("addToTopOfQueue", String(r.top.checked));
            fd.append("contentLayout", r.layout.value);
            if (Number(r.dl.value) > 0)
                fd.append("dlLimit", String(Math.round(Number(r.dl.value) * 1024)));
            if (Number(r.ul.value) > 0)
                fd.append("upLimit", String(Math.round(Number(r.ul.value) * 1024)));
            r.submit.disabled = true;
            try {
                const res = await api.form("torrents/add", fd);
                if (String(res).trim().startsWith("Fails")) {
                    toast(T("qBittorrent rejected the torrent (already added, or invalid link?)"), "err");
                    r.submit.disabled = false;
                    return;
                }
                toast(T("Torrent added"), "ok");
                sheet.close();
                kickSync();
            }
            catch (err) {
                toast(err.message || T("Could not add"), "err");
                r.submit.disabled = false;
            }
        });
        if (!url)
            setTimeout(() => r.urls.focus(), 350);
    };

    // =====================================================================
    // Vista: Torrents
    // =====================================================================
    const TV = {};
    const setSelecting = (on) => {
        S.selecting = on;
        if (!on) {
            S.sel.clear();
            if (selHistory) {
                selHistory = false;
                ignorePop++;
                history.back();
            }
        }
        document.body.classList.toggle("selecting", on);
        renderTorrents();
    };

    const buildTorrentsView = () => {
        const el = h(`<section class="view" data-view="torrents">
            <div class="safe-top"></div>
            <div class="main" data-ref="main">
                <div class="head">
                    <h1>Torrents</h1>
                    <button class="icon-btn" data-ref="alt" aria-label="${T("Alternative speed limits")}">${ic("snail")}</button>
                    <button class="icon-btn" data-ref="filterBtn" aria-label="${T("Filters")}">${ic("filter")}<span class="dot hidden" data-ref="filterDot"></span></button>
                </div>
                <div class="speeds">
                    <button class="speed dl" data-ref="dlBox"><span class="ic">${ic("down", "sm")}</span><span style="min-width:0;text-align:left"><b data-ref="dl">—</b><small data-ref="dlSub">&nbsp;</small></span></button>
                    <button class="speed up" data-ref="upBox"><span class="ic">${ic("up", "sm")}</span><span style="min-width:0;text-align:left"><b data-ref="up">—</b><small data-ref="upSub">&nbsp;</small></span></button>
                </div>
                <div class="diskline" data-ref="disk">${ic("hdd", "sm")}<span>${T("Free space")}</span><b data-ref="free">—</b></div>
                <div class="offline hidden" data-ref="offline">${ic("wifiOff", "sm")} ${T("Lost connection to qBittorrent. Retrying…")}</div>
                <div class="sticky">
                    <label class="searchbar">${ic("search", "sm")}<input type="search" data-ref="q" placeholder="${T("Search your torrents")}" autocomplete="off" autocapitalize="none" enterkeyhint="search"><button type="button" class="icon-btn plain hidden" data-ref="qClear" style="width:34px;height:34px" aria-label="${T("Clear")}">${ic("x", "sm")}</button></label>
                    <div class="chips" data-ref="chips"></div>
                </div>
                <div class="listinfo"><span data-ref="count"></span><button data-ref="sortBtn">${ic("sort", "sm")}<span data-ref="sortLbl"></span></button></div>
                <div class="tlist" data-ref="list"></div>
                <div class="empty hidden" data-ref="empty"></div>
            </div>
            <div class="selhead-fixed"><div class="selhead">
                <button class="icon-btn" data-ref="selClose" aria-label="${T("Cancel selection")}">${ic("x")}</button>
                <b data-ref="selCount">${T("{0} selected", 0)}</b>
                <button class="icon-btn" data-ref="selAll" aria-label="${T("Select all")}">${ic("checkAll")}</button>
            </div></div>
            <button class="fab" data-ref="fab" aria-label="${T("Add torrent")}">${ic("plus")}</button>
            <div class="selbar" data-ref="selbar">
                <button data-a="start">${ic("play")}${T("Start")}</button>
                <button data-a="stop">${ic("pause")}${T("Stop")}</button>
                <button data-a="category">${ic("folder")}${T("Category")}</button>
                <button data-a="delete" class="danger">${ic("trash")}${T("Delete")}</button>
                <button data-a="more">${ic("more")}${T("More")}</button>
            </div>
        </section>`);
        Object.assign(TV, refs(el));

        TV.q.addEventListener("input", () => {
            S.q = TV.q.value.trim();
            TV.qClear.classList.toggle("hidden", !TV.q.value);
            renderTorrents();
        });
        TV.q.addEventListener("keydown", (e) => {
            if (e.key === "Enter")
                TV.q.blur();
        });
        TV.qClear.addEventListener("click", (e) => {
            e.preventDefault();
            TV.q.value = "";
            S.q = "";
            TV.qClear.classList.add("hidden");
            renderTorrents();
        });
        TV.chips.addEventListener("click", (e) => {
            const c = e.target.closest("[data-f]");
            if (!c)
                return;
            S.filter.status = c.dataset.f;
            saveFilter();
            renderTorrents();
            TV.main.scrollTo({ top: Math.min(TV.main.scrollTop, TV.chips.closest(".sticky").offsetTop), behavior: "smooth" });
        });
        TV.alt.addEventListener("click", async () => {
            const on = !S.server.use_alt_speed_limits;
            const ok = await run(api.post("transfer/toggleSpeedLimitsMode"), on ? T("Alternative speed limits on") : T("Alternative speed limits off"));
            if (ok !== null) {
                S.server.use_alt_speed_limits = on;
                renderHeader();
            }
        });
        TV.dlBox.addEventListener("click", () => globalLimitSheet("dl"));
        TV.upBox.addEventListener("click", () => globalLimitSheet("up"));
        TV.filterBtn.addEventListener("click", filterSheet);
        TV.sortBtn.addEventListener("click", sortSheet);
        TV.fab.addEventListener("click", () => addSheet());
        TV.selClose.addEventListener("click", () => setSelecting(false));
        TV.selAll.addEventListener("click", () => {
            const visible = TV.visible || [];
            const allSel = visible.every((x) => S.sel.has(x));
            if (allSel)
                S.sel.clear();
            else
                for (const x of visible) S.sel.add(x);
            renderTorrents();
        });
        TV.selbar.addEventListener("click", (e) => {
            const b = e.target.closest("[data-a]");
            if (!b)
                return;
            const hs = [...S.sel];
            if (!hs.length)
                return toast(T("Select at least one torrent"), "err");
            const a = b.dataset.a;
            if (a === "more")
                moreMenu(hs, { after: () => setSelecting(false) });
            else if (a === "delete")
                actions.delete(hs, () => setSelecting(false));
            else
                actions[a](hs);
        });

        pressable(TV.list, ".tcard", {
            onTap: (card, e) => {
                const hash = card.dataset.h;
                if (e.target.closest(".quick")) {
                    actions.toggle([hash]);
                    return;
                }
                if (S.selecting) {
                    if (S.sel.has(hash))
                        S.sel.delete(hash);
                    else
                        S.sel.add(hash);
                    if (!S.sel.size)
                        setSelecting(false);
                    else
                        renderTorrents();
                    return;
                }
                openDetail(hash);
            },
            onLong: (card) => {
                const hash = card.dataset.h;
                if (!S.selecting) {
                    S.sel.clear();
                    S.sel.add(hash);
                    setSelecting(true);
                    history.pushState({ penumbraSel: true }, "");
                    selHistory = true;
                }
                else {
                    S.sel.add(hash);
                    renderTorrents();
                }
            }
        });
        return el;
    };

    const globalLimitSheet = async (dir) => {
        const alt = !!S.server.use_alt_speed_limits;
        const key = alt ? ((dir === "dl") ? "alt_dl_limit" : "alt_up_limit") : ((dir === "dl") ? "dl_limit" : "up_limit");
        const cur = S.prefs[key] ?? ((dir === "dl") ? S.server.dl_rate_limit : S.server.up_rate_limit) ?? 0;
        const v = await promptSheet({
            title: `${(dir === "dl") ? T("Global download limit") : T("Global upload limit")}${alt ? T(" (alternative)") : ""}`,
            label: T("KiB/s (0 = unlimited)"),
            value: String(Math.round((cur || 0) / 1024)),
            type: "number",
            inputmode: "numeric",
            hint: alt ? T("Alternative speed limits are active.") : ""
        });
        if (v === null)
            return;
        const bytes = Math.round(Math.max(0, Number(v) || 0) * 1024);
        if (await setPrefs({ [key]: bytes }, bytes ? T("Limit: {0}", fmtSpeed(bytes)) : T("No limit")))
            kickSync();
    };

    const renderHeader = () => {
        const s = S.server;
        TV.dl.textContent = fmtSpeed(s.dl_info_speed);
        TV.up.textContent = fmtSpeed(s.up_info_speed);
        TV.dlSub.textContent = (s.dl_rate_limit > 0) ? T("Limit {0}", fmtSpeed(s.dl_rate_limit)) : T("Session {0}", fmtBytes(s.dl_info_data));
        TV.upSub.textContent = (s.up_rate_limit > 0) ? T("Limit {0}", fmtSpeed(s.up_rate_limit)) : T("Session {0}", fmtBytes(s.up_info_data));
        TV.alt.classList.toggle("on", !!s.use_alt_speed_limits);
        TV.free.textContent = (s.free_space_on_disk >= 0) ? fmtBytes(s.free_space_on_disk) : "—";
        TV.disk.classList.toggle("low", (s.free_space_on_disk >= 0) && (s.free_space_on_disk < 10 * 1024 ** 3));
        TV.offline.classList.toggle("hidden", S.online);
    };

    const cardCreate = (t) => {
        const el = h(`<article class="tcard">
            <div class="row1"><span class="check">${ic("check", "xs")}</span><div class="name"></div><button class="quick" aria-label="${T("Start or stop")}"></button></div>
            <div class="bar"><i></i></div>
            <div class="meta"></div>
            <div class="tags"></div>
        </article>`);
        el.dataset.h = t.hash;
        el._name = el.querySelector(".name");
        el._quick = el.querySelector(".quick");
        el._bar = el.querySelector(".bar > i");
        el._meta = el.querySelector(".meta");
        el._tags = el.querySelector(".tags");
        return el;
    };

    const metaHtml = (t) => {
        const st = stateOf(t);
        const parts = [`<span class="state">${esc(st.label)}</span>`];
        const done = t.progress >= 1;
        parts.push(`<span>${fmtPct(t.progress)}</span>`);
        if (!t.size && (t.has_metadata === false || !t.total_size))
            parts.push("<span>" + T("No metadata") + "</span>");
        else
            parts.push(`<span>${done ? fmtBytes(t.size) : T("{0} of {1}", fmtBytes(t.completed ?? (t.size * t.progress)), fmtBytes(t.size))}</span>`);
        if (t.dlspeed > 0)
            parts.push(`<span class="sp-dl">${ic("down", "xs")}${fmtSpeed(t.dlspeed)}</span>`);
        if (t.upspeed > 0)
            parts.push(`<span class="sp-up">${ic("up", "xs")}${fmtSpeed(t.upspeed)}</span>`);
        if (!isStopped(t) && ((t.num_seeds > 0) || (t.num_leechs > 0)))
            parts.push(`<span>${ic("users", "xs")}${t.num_seeds}/${t.num_leechs}</span>`);
        if (!done && (t.eta < 8640000) && (t.dlspeed > 0))
            parts.push(`<span class="push">${ic("clock", "xs")}${fmtDur(t.eta)}</span>`);
        else if (done)
            parts.push(`<span class="push">Ratio ${fmtRatio(t.ratio)}</span>`);
        return parts.join("");
    };

    const tagsHtml = (t) => {
        const out = [];
        if (t.force_start)
            out.push(`<span class="tag">${T("Forced")}</span>`);
        if (t.category)
            out.push(`<span class="tag cat">${esc(t.category)}</span>`);
        for (const tg of tagsOf(t))
            out.push(`<span class="tag">#${esc(tg)}</span>`);
        if ((t.state === "error") || (t.state === "missingFiles"))
            out.push(`<span class="tag warn">${esc(stateOf(t).label)}</span>`);
        return out.join("");
    };

    const cardUpdate = (el, t) => {
        const sel = S.sel.has(t.hash);
        const sig = [t.name, t.state, t.progress, t.dlspeed, t.upspeed, t.eta, t.size, t.completed, t.ratio, t.num_seeds, t.num_leechs, t.category, t.tags, t.force_start, sel].join("|");
        if (el._sig === sig)
            return;
        el._sig = sig;
        const st = stateOf(t);
        el.className = `tcard ${st.cls}${sel ? " selected" : ""}`;
        if (el._name.textContent !== t.name)
            el._name.textContent = t.name;
        const q = isStopped(t) ? "play" : "pause";
        if (el._quick.dataset.q !== q) {
            el._quick.dataset.q = q;
            el._quick.innerHTML = ic(q, "sm");
            el._quick.setAttribute("aria-label", isStopped(t) ? T("Start") : T("Stop"));
        }
        el._bar.style.width = `${Math.min(100, t.progress * 100)}%`;
        el._meta.innerHTML = metaHtml(t);
        const tg = tagsHtml(t);
        el._tags.innerHTML = tg;
        el._tags.classList.toggle("hidden", !tg);
    };

    const renderTorrents = () => {
        if (!TV.list)
            return;
        renderHeader();
        const all = [...S.torrents.values()];
        const base = all.filter(matchOthers);

        // Chips de estado con conteo
        const counts = {};
        for (const [k] of STATUS_FILTERS)
            counts[k] = 0;
        for (const t of base) {
            for (const [k] of STATUS_FILTERS) {
                if (matchStatus(t, k))
                    counts[k]++;
            }
        }
        const chipSig = STATUS_FILTERS.map(([k]) => `${k}:${counts[k]}`).join(",") + S.filter.status;
        if (TV.chips._sig !== chipSig) {
            TV.chips._sig = chipSig;
            TV.chips.innerHTML = STATUS_FILTERS
                .filter(([k]) => ALWAYS_CHIPS.has(k) || counts[k] > 0 || S.filter.status === k)
                .map(([k, label]) => `<button class="chip ${(S.filter.status === k) ? "active" : ""}" data-f="${k}">${esc(label)}<span class="n">${counts[k]}</span></button>`)
                .join("");
        }

        const list = sortTorrents(base.filter((t) => matchStatus(t, S.filter.status)));
        TV.visible = list.map((t) => t.hash);
        keyed(TV.list, list, (t) => t.hash, cardCreate, cardUpdate);

        const f = S.filter;
        const extra = (f.category !== null) || (f.tag !== null) || (f.tracker !== null);
        TV.filterDot.classList.toggle("hidden", !extra);
        TV.filterBtn.classList.toggle("on", extra);
        const filterDesc = [];
        if (f.category !== null)
            filterDesc.push((f.category === "") ? T("no category") : f.category);
        if (f.tag !== null)
            filterDesc.push((f.tag === "") ? T("no tag") : `#${f.tag}`);
        if (f.tracker !== null)
            filterDesc.push((f.tracker === "") ? T("no tracker") : f.tracker);
        TV.count.textContent = `${list.length} ${(list.length === 1) ? "torrent" : "torrents"}${filterDesc.length ? ` · ${filterDesc.join(" · ")}` : ""}`;
        const sortDef = SORTS.find(([k]) => k === S.sort.key);
        TV.sortLbl.textContent = `${sortDef ? sortDef[1] : ""} ${(S.sort.dir > 0) ? "↑" : "↓"}`;

        if (!S.loaded) {
            TV.empty.innerHTML = "<div class=\"spinner\"></div>";
            TV.empty.classList.remove("hidden");
        }
        else if (!list.length) {
            const none = !all.length;
            TV.empty.innerHTML = none
                ? `${ic("layers")}<b>${T("No torrents yet")}</b><span>${T("Tap the + button to add a magnet link or a .torrent file.")}</span>`
                : `${ic("search")}<b>${T("Nothing here")}</b><span>${T("No torrent matches the filters.")}</span>${extra || S.q ? "<button class=\"sec-btn\" data-clear>" + T("Clear filters") + "</button>" : ""}`;
            TV.empty.querySelector("[data-clear]")?.addEventListener("click", () => {
                Object.assign(S.filter, { status: "all", category: null, tag: null, tracker: null });
                S.q = "";
                TV.q.value = "";
                saveFilter();
                renderTorrents();
            });
            TV.empty.classList.remove("hidden");
        }
        else {
            TV.empty.classList.add("hidden");
        }

        if (S.selecting) {
            const n = S.sel.size;
            TV.selCount.textContent = ((n === 1) ? T("{0} selected§one", n) : T("{0} selected", n));
        }
    };

    const filterSheet = () => {
        const body = h("<div></div>");
        const sheet = openSheet({ title: T("Filters"), body });
        const render = () => {
            const all = [...S.torrents.values()];
            const f = S.filter;
            const section = (title, key, entries) => {
                const g = h(`<div><div class="group-title">${esc(title)}</div><div class="group optlist"></div></div>`);
                const grp = g.querySelector(".group");
                for (const [value, label, count, icon] of entries) {
                    const b = h(`<button class="item"><span class="ico ${(value === null) ? "" : "accent"}">${ic(icon, "sm")}</span><span class="lbl">${esc(label)}</span><span class="val">${count}</span><span class="radio ${(f[key] === value) ? "on" : ""}"></span></button>`);
                    b.addEventListener("click", () => {
                        f[key] = value;
                        saveFilter();
                        renderTorrents();
                        render();
                    });
                    grp.append(b);
                }
                return g;
            };
            body.innerHTML = "";
            const catEntries = [[null, T("All§f"), all.length, "layers"], ["", T("No category"), all.filter((t) => !t.category).length, "x"]];
            for (const c of Object.keys(S.categories).sort(collator.compare)) {
                const n = all.filter((t) => (S.prefs.use_subcategories ? (`${t.category}/`).startsWith(`${c}/`) : (t.category === c))).length;
                catEntries.push([c, c, n, "folder"]);
            }
            body.append(section(T("Categories"), "category", catEntries));
            const tagEntries = [[null, T("All§f"), all.length, "layers"], ["", T("No tag"), all.filter((t) => !t.tags).length, "x"]];
            for (const tg of [...S.tags].sort(collator.compare))
                tagEntries.push([tg, tg, all.filter((t) => tagsOf(t).includes(tg)).length, "tag"]);
            body.append(section(T("Tags"), "tag", tagEntries));
            const trEntries = [[null, T("All"), all.length, "layers"], ["", T("No tracker"), all.filter((t) => t.trackers_count === 0).length, "x"]];
            for (const host of [...trackerHostMap.keys()].sort(collator.compare))
                trEntries.push([host, host, trackerHostMap.get(host).size, "radio"]);
            body.append(section("Trackers", "tracker", trEntries));
            const btns = h(`<div class="btns" style="margin-top:14px"><button class="btn" data-ref="reset">${T("Clear filters")}</button><button class="btn primary" data-ref="done">${T("Done")}</button></div>`);
            const r = refs(btns);
            r.reset.addEventListener("click", () => {
                Object.assign(f, { category: null, tag: null, tracker: null });
                saveFilter();
                renderTorrents();
                render();
            });
            r.done.addEventListener("click", () => sheet.close());
            body.append(btns);
        };
        render();
    };

    const sortSheet = () => {
        const body = h("<div class=\"group optlist\"></div>");
        const sheet = openSheet({ title: T("Sort by"), subtitle: T("Tap again to reverse the order"), body });
        const render = () => {
            body.innerHTML = "";
            for (const [key, label, defDir] of SORTS) {
                const on = S.sort.key === key;
                const b = h(`<button class="item"><span class="lbl">${esc(label)}</span>${on ? `<span class="val">${(S.sort.dir > 0) ? T("Ascending ↑") : T("Descending ↓")}</span>` : ""}<span class="radio ${on ? "on" : ""}"></span></button>`);
                b.addEventListener("click", () => {
                    if (S.sort.key === key)
                        S.sort.dir *= -1;
                    else
                        S.sort = { key, dir: defDir };
                    store.set("sort", S.sort);
                    renderTorrents();
                    render();
                    if (S.sort.key !== key)
                        sheet.close();
                });
                body.append(b);
            }
        };
        render();
    };

    // =====================================================================
    // Detalle de torrent
    // =====================================================================
    const openDetail = (hash) => {
        let t = tor(hash);
        if (!t)
            return;
        let tab = store.get("detailTab", "info");
        let timer = null;
        let alive = true;
        let props = null;
        let files = null;
        let collapsed = new Set();
        let peersRid = 0;
        let peers = {};

        const page = openPage({
            title: T("Details"),
            actions: `<button class="icon-btn" data-ref="more" aria-label="${T("More actions")}">${ic("more")}</button>`,
            onClose: () => {
                alive = false;
                clearTimeout(timer);
                unsub();
            }
        });
        const P = page.r;
        P.main.innerHTML = `
            <div class="hero" data-ref="hero">
                <span class="state" data-ref="state"></span>
                <div class="tname" data-ref="name"></div>
                <div class="big"><b data-ref="pct"></b><span data-ref="sizeTxt"></span></div>
                <div class="bar"><i data-ref="bar"></i></div>
                <div class="meta" data-ref="meta"></div>
                <canvas class="pieces hidden" data-ref="pieces" height="10"></canvas>
                <div class="tags" data-ref="tags"></div>
            </div>
            <div class="actions">
                <button data-a="toggle" class="primary" data-ref="toggleBtn"></button>
                <button data-a="reannounce">${ic("megaphone")}${T("Reannounce")}</button>
                <button data-a="magnet">${ic("magnet")}Magnet</button>
                <button data-a="delete" class="danger">${ic("trash")}${T("Delete")}</button>
            </div>
            <div class="seg" data-ref="seg">
                <button data-t="info">Info</button>
                <button data-t="files">${T("Files")}</button>
                <button data-t="trackers">Trackers</button>
                <button data-t="peers">${T("Peers")}</button>
            </div>
            <div data-ref="body"><div class="fetching"><span class="spinner"></span></div></div>`;
        Object.assign(P, refs(P.main));
        const R = P;

        page.r.more.addEventListener("click", () => moreMenu([hash], { after: () => page.close() }));
        P.main.querySelector(".actions").addEventListener("click", (e) => {
            const b = e.target.closest("[data-a]");
            if (!b)
                return;
            const a = b.dataset.a;
            if (a === "magnet")
                copyText(t.magnet_uri, T("Magnet link copied"));
            else if (a === "delete")
                actions.delete([hash], () => page.close());
            else
                actions[a]([hash]);
        });
        R.seg.addEventListener("click", (e) => {
            const b = e.target.closest("[data-t]");
            if (!b || (b.dataset.t === tab))
                return;
            tab = b.dataset.t;
            store.set("detailTab", tab);
            R.body.innerHTML = "<div class=\"fetching\"><span class=\"spinner\"></span></div>";
            R.body._k = null;
            renderSeg();
            refresh(true);
        });

        const renderSeg = () => {
            for (const b of R.seg.querySelectorAll("[data-t]"))
                b.classList.toggle("active", b.dataset.t === tab);
        };

        const renderHero = () => {
            t = tor(hash) || t;
            const st = stateOf(t);
            R.hero.className = `hero ${st.cls}`;
            R.state.textContent = st.label;
            R.name.textContent = t.name;
            R.pct.textContent = fmtPct(t.progress);
            R.sizeTxt.textContent = (t.progress >= 1) ? T("of {0}", fmtBytes(t.size)) : T("{0} of {1}", fmtBytes(t.completed ?? 0), fmtBytes(t.size));
            R.bar.style.width = `${Math.min(100, t.progress * 100)}%`;
            const m = [];
            m.push(`<span class="sp-dl">${ic("down", "xs")}${fmtSpeed(t.dlspeed)}</span>`);
            m.push(`<span class="sp-up">${ic("up", "xs")}${fmtSpeed(t.upspeed)}</span>`);
            if (t.progress < 1)
                m.push(`<span>${ic("clock", "xs")}${fmtDur(t.eta)}</span>`);
            m.push(`<span>Ratio ${fmtRatio(t.ratio)}</span>`);
            m.push(`<span>${ic("users", "xs")}${t.num_seeds} (${t.num_complete}) · ${t.num_leechs} (${t.num_incomplete})</span>`);
            R.meta.innerHTML = m.join("");
            const tg = tagsHtml(t);
            R.tags.innerHTML = tg;
            R.tags.classList.toggle("hidden", !tg);
            const stopped = isStopped(t);
            const want = stopped ? "play" : "pause";
            if (R.toggleBtn.dataset.q !== want) {
                R.toggleBtn.dataset.q = want;
                R.toggleBtn.innerHTML = `${ic(want)}${stopped ? T("Start") : T("Stop")}`;
            }
        };

        const unsub = onSync(() => {
            if (!S.torrents.has(hash)) {
                if (alive) {
                    toast(T("The torrent no longer exists"));
                    page.close();
                }
                return;
            }
            renderHero();
        });

        // ---------- Info ----------
        const kvItem = (label, value, opts = {}) => `<${opts.copy ? "button" : "div"} class="item ${opts.copy ? "tap" : ""}" ${opts.copy ? `data-copy="${esc(opts.copy)}"` : ""} ${opts.act ? `data-act="${opts.act}"` : ""}>
            <span class="lbl">${esc(label)}</span><span class="val ${opts.mono ? "mono" : ""}">${esc(value)}</span>${opts.act ? `<span class="chev">${ic("chev", "sm")}</span>` : ""}</${opts.copy ? "button" : "div"}>`;
        const renderInfo = () => {
            const p = props || {};
            const html = `
                <div class="group-title">${T("Transfer")}</div>
                <div class="group">
                    ${kvItem(T("Downloaded"), T("{0} (session {1})", fmtBytes(p.total_downloaded), fmtBytes(p.total_downloaded_session)))}
                    ${kvItem(T("Uploaded"), T("{0} (session {1})", fmtBytes(p.total_uploaded), fmtBytes(p.total_uploaded_session)))}
                    ${kvItem("Ratio", fmtRatio(p.share_ratio ?? t.ratio))}
                    ${kvItem(T("Average speed"), `↓ ${fmtSpeed(p.dl_speed_avg)} · ↑ ${fmtSpeed(p.up_speed_avg)}`)}
                    ${kvItem(T("Time active"), fmtDur(p.time_elapsed))}
                    ${kvItem(T("Seeding time"), fmtDur(p.seeding_time))}
                    ${kvItem(T("Connections"), `${p.nb_connections ?? "—"} (${T("max.")} ${(p.nb_connections_limit > 0) ? p.nb_connections_limit : "∞"})`)}
                    ${kvItem(T("Seeds"), `${p.seeds ?? "—"} ${T("of")} ${p.seeds_total ?? "—"}`)}
                    ${kvItem(T("Peers"), `${p.peers ?? "—"} ${T("of")} ${p.peers_total ?? "—"}`)}
                    ${kvItem(T("Availability"), (t.availability >= 0) ? nf(t.availability, 3) : "—")}
                    ${kvItem(T("Wasted"), fmtBytes(p.total_wasted))}
                    ${kvItem(T("Next announce"), fmtDur(p.reannounce))}
                    ${kvItem(T("Last seen complete"), fmtDate(p.last_seen))}
                    ${kvItem(T("Pieces"), `${p.pieces_num ?? "—"} × ${fmtBytes(p.piece_size)} (${T("have {0}", p.pieces_have ?? "—")})`)}
                </div>
                <div class="group-title">${T("Limits")}</div>
                <div class="group">
                    <button class="item tap" data-act="dl"><span class="lbl">${T("Download limit")}</span><span class="val">${esc(fmtLimit(t.dl_limit))}</span><span class="chev">${ic("chev", "sm")}</span></button>
                    <button class="item tap" data-act="up"><span class="lbl">${T("Upload limit")}</span><span class="val">${esc(fmtLimit(t.up_limit))}</span><span class="chev">${ic("chev", "sm")}</span></button>
                    <button class="item tap" data-act="share"><span class="lbl">${T("Share limits")}</span><span class="val">${esc((t.ratio_limit === -2) ? "Global" : ((t.ratio_limit === -1) ? T("No limit") : `Ratio ${nf(t.ratio_limit, 2)}`))}</span><span class="chev">${ic("chev", "sm")}</span></button>
                </div>
                <div class="group-title">${T("Information")}</div>
                <div class="group">
                    ${kvItem(T("Total size"), fmtBytes(p.total_size ?? t.total_size))}
                    ${kvItem(T("Added"), fmtDate(p.addition_date ?? t.added_on))}
                    ${kvItem(T("Completed"), fmtDate(p.completion_date ?? t.completion_on))}
                    ${kvItem(T("Created"), fmtDate(p.creation_date))}
                    ${p.created_by ? kvItem(T("Created by"), p.created_by) : ""}
                    ${kvItem(T("Saved to"), p.save_path ?? t.save_path, { copy: p.save_path ?? t.save_path, mono: true })}
                    ${p.download_path ? kvItem(T("Incomplete path"), p.download_path, { copy: p.download_path, mono: true }) : ""}
                    ${kvItem(T("Category"), t.category || T("None"))}
                    ${kvItem(T("Private"), p.is_private ? T("Yes") : "No")}
                    ${(p.infohash_v1 || t.infohash_v1) ? kvItem("Hash v1", p.infohash_v1 || t.infohash_v1, { copy: p.infohash_v1 || t.infohash_v1, mono: true }) : ""}
                    ${(p.infohash_v2 || t.infohash_v2) ? kvItem("Hash v2", p.infohash_v2 || t.infohash_v2, { copy: p.infohash_v2 || t.infohash_v2, mono: true }) : ""}
                    ${p.comment ? `<div class="item"><span class="lbl">${T("Comment")}<small>${esc(plainText(p.comment))}</small></span></div>` : ""}
                </div>`;
            const sc = P.main.scrollTop;
            R.body.innerHTML = html;
            P.main.scrollTop = sc;
        };
        R.body.addEventListener("click", (e) => {
            const c = e.target.closest("[data-copy]");
            if (c)
                return copyText(c.dataset.copy);
            const a = e.target.closest("[data-act]");
            if (!a)
                return;
            if (a.dataset.act === "dl")
                actions.speedLimit([hash], "dl");
            else if (a.dataset.act === "up")
                actions.speedLimit([hash], "up");
            else if (a.dataset.act === "share")
                actions.shareLimits([hash]);
        });

        const drawPieces = (states) => {
            const c = R.pieces;
            if (!states || !states.length || (t.progress >= 1)) {
                c.classList.add("hidden");
                return;
            }
            c.classList.remove("hidden");
            const w = Math.max(100, Math.round(c.clientWidth * (window.devicePixelRatio || 1)));
            c.width = w;
            c.height = 10;
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#1f2430";
            ctx.fillRect(0, 0, w, 10);
            const n = states.length;
            for (let x = 0; x < w; x++) {
                const a = Math.floor((x * n) / w);
                const b = Math.max(a + 1, Math.floor(((x + 1) * n) / w));
                let have = 0;
                let dl = 0;
                for (let i = a; i < b; i++) {
                    if (states[i] === 2)
                        have++;
                    else if (states[i] === 1)
                        dl++;
                }
                const tot = b - a;
                if (have) {
                    ctx.fillStyle = `rgba(124,140,255,${0.35 + (0.65 * have) / tot})`;
                    ctx.fillRect(x, 0, 1, 10);
                }
                else if (dl) {
                    ctx.fillStyle = "rgba(52,211,153,.75)";
                    ctx.fillRect(x, 0, 1, 10);
                }
            }
        };

        // ---------- Archivos ----------
        const PRIO = { 0: T("Do not download"), 1: "Normal", 6: T("High"), 7: T("Maximum") };
        const buildTree = (list) => {
            const root = { name: "", path: "", children: new Map(), files: [] };
            for (const f of list) {
                const parts = f.name.split("/");
                let node = root;
                for (let i = 0; i < parts.length - 1; i++) {
                    const p = parts.slice(0, i + 1).join("/");
                    if (!node.children.has(parts[i]))
                        node.children.set(parts[i], { name: parts[i], path: p, children: new Map(), files: [] });
                    node = node.children.get(parts[i]);
                }
                node.files.push(f);
            }
            return root;
        };
        const agg = (node) => {
            let size = 0;
            let done = 0;
            const prios = new Set();
            const idx = [];
            for (const c of node.children.values()) {
                const a = agg(c);
                c.agg = a;
                size += a.size;
                done += a.done;
                for (const p of a.prios)
                    prios.add(p);
                idx.push(...a.idx);
            }
            for (const f of node.files) {
                size += f.size;
                done += f.size * f.progress;
                prios.add(f.priority);
                idx.push(f.index);
            }
            return { size, done, prios, idx };
        };
        const flatten = (node, depth, out) => {
            const dirs = [...node.children.values()].sort((a, b) => collator.compare(a.name, b.name));
            for (const d of dirs) {
                out.push({ key: `d:${d.path}`, dir: true, node: d, depth });
                if (!collapsed.has(d.path))
                    flatten(d, depth + 1, out);
            }
            for (const f of [...node.files].sort((a, b) => collator.compare(a.name, b.name)))
                out.push({ key: `f:${f.index}`, dir: false, file: f, depth });
            return out;
        };
        const fileCreate = () => h(`<div class="frow">
            <button class="cb" data-cb>${ic("check", "xs")}</button>
            <span class="fi"></span>
            <div class="lbl"><div class="fname"></div><small></small><div class="mini"><i></i></div></div>
            <span class="prio"></span>
            <span class="tw hidden">${ic("chevDown", "sm")}</span>
        </div>`);
        const fileUpdate = (el, row) => {
            const depth = row.depth;
            let name;
            let size;
            let progress;
            let cbState;
            let prioCls = "p1";
            let prioTxt = "";
            if (row.dir) {
                const a = row.node.agg;
                name = row.node.name;
                size = a.size;
                progress = a.size ? (a.done / a.size) : 1;
                cbState = a.prios.has(0) ? ((a.prios.size === 1) ? "" : "part") : "on";
                if ((a.prios.size === 1) && !a.prios.has(0)) {
                    const p = [...a.prios][0];
                    prioCls = `p${p}`;
                    prioTxt = PRIO[p] || "";
                }
            }
            else {
                const f = row.file;
                name = f.name.split("/").pop();
                size = f.size;
                progress = f.progress;
                cbState = (f.priority > 0) ? "on" : "";
                prioCls = `p${f.priority}`;
                prioTxt = PRIO[f.priority] || "";
            }
            const sig = [name, size, progress, cbState, prioCls, depth, row.dir && collapsed.has(row.node.path)].join("|");
            if (el._sig === sig)
                return;
            el._sig = sig;
            el.dataset.key = row.key;
            el.style.setProperty("--depth", depth);
            el.classList.toggle("collapsed", row.dir && collapsed.has(row.node.path));
            el.querySelector(".cb").className = `cb ${cbState}`;
            el.querySelector(".fi").className = `fi ${row.dir ? "folder" : ""}`;
            el.querySelector(".fi").innerHTML = ic(row.dir ? "folder" : "file", "sm");
            el.querySelector(".fname").textContent = name;
            el.querySelector("small").textContent = `${fmtBytes(size)} · ${fmtPct(progress)}`;
            el.querySelector(".mini i").style.width = `${progress * 100}%`;
            const pr = el.querySelector(".prio");
            pr.className = `prio ${(cbState === "") ? "p0" : prioCls}`;
            pr.textContent = (cbState === "") ? T("Skipped") : prioTxt;
            el.querySelector(".tw").classList.toggle("hidden", !row.dir);
        };
        let fileRows = new Map();
        const renderFiles = () => {
            if (!files)
                return;
            let wrap = R.body.querySelector("[data-files]");
            if (!wrap) {
                R.body.innerHTML = `<div class="tools"><label class="searchbar">${ic("search", "sm")}<input type="search" data-fq placeholder="${T("Filter files")}" autocapitalize="none"></label><button class="sec-btn" data-allf>${ic("checkAll", "sm")}${T("All")}</button></div><div class="group" data-files></div>`;
                wrap = R.body.querySelector("[data-files]");
                R.body.querySelector("[data-fq]").addEventListener("input", renderFiles);
                R.body.querySelector("[data-allf]").addEventListener("click", () => {
                    const anyOff = files.some((f) => f.priority === 0);
                    setPrio(files.map((f) => f.index), anyOff ? 1 : 0);
                });
            }
            const q = (R.body.querySelector("[data-fq]")?.value || "").trim().toLowerCase();
            let rows;
            if (q) {
                rows = files.filter((f) => f.name.toLowerCase().includes(q)).map((f) => ({ key: `f:${f.index}`, dir: false, file: f, depth: 0 }));
            }
            else {
                const tree = buildTree(files);
                tree.agg = agg(tree);
                rows = flatten(tree, 0, []);
            }
            fileRows = new Map(rows.map((r) => [r.key, r]));
            if (!rows.length) {
                wrap._k = null;
                wrap.innerHTML = `<div class="item"><span class="lbl" style="color:var(--text-faint)">${q ? T("No file matches") : T("No files yet (waiting for metadata)")}</span></div>`;
                return;
            }
            if (!wrap._k)
                wrap.innerHTML = "";
            keyed(wrap, rows, (r) => r.key, fileCreate, fileUpdate);
        };
        const setPrio = async (ids, prio) => {
            const ok = await run(api.post("torrents/filePrio", { hash, id: ids.join("|"), priority: prio }));
            if (ok !== null && files) {
                const set = new Set(ids);
                for (const f of files) {
                    if (set.has(f.index))
                        f.priority = prio;
                }
                renderFiles();
            }
        };
        const fileSheet = (row) => {
            const isDir = row.dir;
            const ids = isDir ? row.node.agg.idx : [row.file.index];
            const path = isDir ? row.node.path : row.file.name;
            const cur = isDir ? ((row.node.agg.prios.size === 1) ? [...row.node.agg.prios][0] : null) : row.file.priority;
            menuSheet({
                title: path.split("/").pop(),
                subtitle: isDir ? T("Folder · {0}", fmtBytes(row.node.agg.size)) : `${fmtBytes(row.file.size)} · ${fmtPct(row.file.progress)}${(row.file.availability >= 0) ? T(" · avail. {0}", nf(row.file.availability, 2)) : ""}`,
                groups: [
                    {
                        title: T("Priority"),
                        items: [[0, T("Do not download"), "x"], [1, "Normal", "list"], [6, T("High"), "up"], [7, T("Maximum"), "zap"]].map(([p, label, icon]) => ({
                            icon,
                            label,
                            value: cur === p,
                            onClick: () => setPrio(ids, p)
                        }))
                    },
                    {
                        items: [
                            {
                                icon: "edit",
                                label: isDir ? T("Rename folder…") : T("Rename file…"),
                                onClick: async () => {
                                    const base = path.split("/").pop();
                                    const v = await promptSheet({ title: isDir ? T("Rename folder") : T("Rename file"), label: T("New name"), value: base });
                                    if (!v || !v.trim() || (v.trim() === base))
                                        return;
                                    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
                                    const ok = await run(api.post(isDir ? "torrents/renameFolder" : "torrents/renameFile", { hash, oldPath: path, newPath: parent + v.trim() }), T("Renamed"));
                                    if (ok !== null)
                                        refresh(true);
                                }
                            },
                            { icon: "copy", label: T("Copy path"), onClick: () => copyText(path) }
                        ]
                    }
                ]
            });
        };
        pressable(R.body, ".frow", {
            onTap: (el, e) => {
                const row = fileRows.get(el.dataset.key);
                if (!row)
                    return;
                if (e.target.closest("[data-cb]")) {
                    if (row.dir) {
                        const a = row.node.agg;
                        setPrio(a.idx, a.prios.has(0) ? 1 : 0);
                    }
                    else {
                        setPrio([row.file.index], (row.file.priority > 0) ? 0 : 1);
                    }
                    return;
                }
                if (row.dir) {
                    if (collapsed.has(row.node.path))
                        collapsed.delete(row.node.path);
                    else
                        collapsed.add(row.node.path);
                    renderFiles();
                }
                else {
                    fileSheet(row);
                }
            },
            onLong: (el) => {
                const row = fileRows.get(el.dataset.key);
                if (row)
                    fileSheet(row);
            }
        });

        // ---------- Trackers ----------
        const TSTAT = { 0: [T("Disabled"), ""], 1: [T("Not contacted"), "wait"], 2: [T("Working"), "ok"], 3: [T("Updating…"), "upd"], 4: [T("Not working"), "bad"] };
        let trackers = [];
        let webseeds = [];
        const renderTrackers = () => {
            const special = (u) => u.startsWith("** [");
            R.body.innerHTML = `
                <div class="tools"><span style="flex:1;color:var(--text-faint);font-size:13px">${trackers.filter((x) => !special(x.url)).length} trackers</span><button class="sec-btn" data-addtr>${ic("plus", "sm")}${T("Add")}</button></div>
                <div class="group">${trackers.map((tr) => {
                    const [label, cls] = TSTAT[tr.status] || ["—", ""];
                    const name = special(tr.url) ? tr.url.replace(/\*\*\s*\[|\]\s*\*\*/g, "").trim() : tr.url;
                    return `<div class="trow" ${special(tr.url) ? "" : `data-url="${esc(tr.url)}"`}>
                        <div class="url">${esc(name)}</div>
                        <small><span class="tstat ${cls}">${esc(label)}</span>${special(tr.url) ? "" : `<span>${T("Tier {0}", tr.tier)}</span>`}<span>${ic("users", "xs")} ${(tr.num_peers >= 0) ? tr.num_peers : "—"}</span><span>${T("Seeds")} ${(tr.num_seeds >= 0) ? tr.num_seeds : "—"}</span><span>Leechers ${(tr.num_leeches >= 0) ? tr.num_leeches : "—"}</span>${(tr.num_downloaded >= 0) ? `<span>${T("Downloads")} ${tr.num_downloaded}</span>` : ""}</small>
                        ${tr.msg ? `<div class="msg">${esc(tr.msg)}</div>` : ""}
                    </div>`;
                }).join("")}</div>
                <div class="group-title">${T("Web seeds")}</div>
                <div class="group">${webseeds.length ? webseeds.map((w) => `<div class="trow" data-ws="${esc(w.url)}"><div class="url">${esc(w.url)}</div></div>`).join("") : "<div class=\"item\"><span class=\"lbl\" style=\"color:var(--text-faint)\">" + T("None") + "</span></div>"}</div>
                <button class="sec-btn" data-addws>${ic("plus", "sm")}${T("Add web seeds")}</button>`;
        };
        R.body.addEventListener("click", async (e) => {
            if (tab !== "trackers")
                return;
            if (e.target.closest("[data-addtr]")) {
                const v = await promptSheet({ title: T("Add trackers"), label: T("One tracker per line"), multiline: true, placeholder: T("udp://tracker.example.org:1337/announce"), ok: T("Add") });
                if (v && v.trim()) {
                    await run(api.post("torrents/addTrackers", { hash, urls: v.trim() }), T("Trackers added"));
                    refresh(true);
                }
                return;
            }
            if (e.target.closest("[data-addws]")) {
                const v = await promptSheet({ title: T("Add web seeds"), label: T("One URL per line"), multiline: true, placeholder: "https://…", ok: T("Add") });
                if (v && v.trim()) {
                    await run(api.post("torrents/addWebSeeds", { hash, urls: v.trim().split("\n").map((x) => x.trim()).filter(Boolean).join("|") }), T("Web seeds added"));
                    refresh(true);
                }
                return;
            }
            const ws = e.target.closest("[data-ws]");
            if (ws) {
                const url = ws.dataset.ws;
                menuSheet({
                    title: T("Web seed"),
                    subtitle: url,
                    items: [
                        { icon: "copy", label: T("Copy URL"), onClick: () => copyText(url) },
                        {
                            icon: "edit",
                            label: T("Edit URL…"),
                            onClick: async () => {
                                const v = await promptSheet({ title: T("Edit web seed"), value: url, type: "url" });
                                if (v && v.trim() && (v.trim() !== url)) {
                                    await run(api.post("torrents/editWebSeed", { hash, origUrl: url, newUrl: v.trim() }), T("Saved"));
                                    refresh(true);
                                }
                            }
                        },
                        { icon: "trash", label: T("Delete"), danger: true, onClick: async () => {
                            await run(api.post("torrents/removeWebSeeds", { hash, urls: url }), T("Removed§f"));
                            refresh(true);
                        } }
                    ]
                });
                return;
            }
            const row = e.target.closest("[data-url]");
            if (!row)
                return;
            const url = row.dataset.url;
            menuSheet({
                title: hostOf(url),
                subtitle: url,
                items: [
                    { icon: "copy", label: T("Copy URL"), onClick: () => copyText(url, T("URL copied")) },
                    {
                        icon: "edit",
                        label: T("Edit URL…"),
                        onClick: async () => {
                            const v = await promptSheet({ title: T("Edit tracker"), value: url, type: "url" });
                            if (v && v.trim() && (v.trim() !== url)) {
                                await run(api.post("torrents/editTracker", { hash, origUrl: url, newUrl: v.trim() }), T("Tracker updated"));
                                refresh(true);
                            }
                        }
                    },
                    {
                        icon: "trash",
                        label: T("Remove tracker"),
                        danger: true,
                        onClick: async () => {
                            await run(api.post("torrents/removeTrackers", { hash, urls: url }), T("Tracker removed"));
                            refresh(true);
                        }
                    }
                ]
            });
        });

        // ---------- Pares ----------
        const peerCreate = () => h(`<div class="prow"><div class="top"><span class="flag"></span><span class="ip"></span><span class="prio p6" style="display:inline-block"></span></div><small></small></div>`);
        const peerUpdate = (el, p) => {
            const sig = [p.progress, p.dl_speed, p.up_speed, p.client, p.flags, p.connection].join("|");
            if (el._sig === sig)
                return;
            el._sig = sig;
            el.dataset.peer = p.key;
            el.querySelector(".flag").textContent = flag(p.country_code);
            el.querySelector(".flag").title = p.country || "";
            el.querySelector(".ip").textContent = p.key;
            el.querySelector(".prio").textContent = fmtPct(p.progress || 0);
            el.querySelector("small").innerHTML = `<span>${esc(p.client || T("Unknown"))}</span><span class="sp-dl" style="color:var(--c-dl)">↓ ${fmtSpeed(p.dl_speed)}</span><span style="color:var(--c-up)">↑ ${fmtSpeed(p.up_speed)}</span><span>${esc(p.connection || "")}</span>${p.flags ? `<span class="mono">${esc(p.flags)}</span>` : ""}`;
        };
        const renderPeers = () => {
            let wrap = R.body.querySelector("[data-peers]");
            if (!wrap) {
                R.body.innerHTML = `<div class="tools"><span style="flex:1;color:var(--text-faint);font-size:13px" data-pc></span><button class="sec-btn" data-addpeer>${ic("plus", "sm")}${T("Add")}</button></div><div class="group" data-peers></div>`;
                wrap = R.body.querySelector("[data-peers]");
                R.body.querySelector("[data-addpeer]").addEventListener("click", async () => {
                    const v = await promptSheet({ title: T("Add peers"), label: T("IP:port, one per line"), multiline: true, placeholder: "192.168.1.10:6881", ok: T("Add") });
                    if (v && v.trim())
                        run(api.post("torrents/addPeers", { hashes: hash, peers: v.trim().split("\n").map((x) => x.trim()).filter(Boolean).join("|") }), T("Peers added"));
                });
            }
            const list = Object.entries(peers).map(([key, p]) => Object.assign({ key }, p))
                .sort((a, b) => ((b.dl_speed + b.up_speed) - (a.dl_speed + a.up_speed)) || collator.compare(a.key, b.key));
            R.body.querySelector("[data-pc]").textContent = ((list.length === 1) ? T("{0} connected peer", list.length) : T("{0} connected peers", list.length));
            if (!list.length) {
                wrap._k = null;
                wrap.innerHTML = "<div class=\"item\"><span class=\"lbl\" style=\"color:var(--text-faint)\">" + T("No connected peers") + "</span></div>";
                return;
            }
            if (!wrap._k)
                wrap.innerHTML = "";
            keyed(wrap, list, (p) => p.key, peerCreate, peerUpdate);
        };
        pressable(R.body, ".prow", {
            onTap: (el) => {
                const key = el.dataset.peer;
                const p = peers[key] || {};
                menuSheet({
                    title: key,
                    subtitle: [p.client, p.country].filter(Boolean).join(" · "),
                    items: [
                        { icon: "copy", label: T("Copy IP:port"), onClick: () => copyText(key) },
                        {
                            icon: "ban",
                            label: T("Ban permanently"),
                            danger: true,
                            onClick: async () => {
                                if (await confirmSheet({ title: T("Ban this peer?"), message: key, ok: T("Ban"), danger: true })) {
                                    await run(api.post("transfer/banPeers", { peers: key }), T("Peer banned"));
                                    delete peers[key];
                                    renderPeers();
                                }
                            }
                        }
                    ]
                });
            }
        });

        // ---------- Ciclo de refresco ----------
        let pieceTick = 0;
        const refresh = async (immediate) => {
            clearTimeout(timer);
            if (!alive)
                return;
            try {
                if (tab === "info") {
                    props = await api.get("torrents/properties", { hash });
                    if (!alive || (tab !== "info"))
                        return;
                    renderInfo();
                }
                else if (tab === "files") {
                    files = await api.get("torrents/files", { hash });
                    if (!alive || (tab !== "files"))
                        return;
                    renderFiles();
                }
                else if (tab === "trackers") {
                    [trackers, webseeds] = await Promise.all([api.get("torrents/trackers", { hash }), api.get("torrents/webseeds", { hash }).catch(() => [])]);
                    if (!alive || (tab !== "trackers"))
                        return;
                    renderTrackers();
                }
                else if (tab === "peers") {
                    const d = await api.get("sync/torrentPeers", { hash, rid: peersRid });
                    if (!alive || (tab !== "peers"))
                        return;
                    if (d.full_update)
                        peers = {};
                    for (const [k, v] of Object.entries(d.peers || {}))
                        peers[k] = Object.assign(peers[k] || {}, v);
                    for (const k of d.peers_removed || [])
                        delete peers[k];
                    peersRid = d.rid;
                    renderPeers();
                }
                if ((t.progress < 1) && (immediate || ((pieceTick++ % 3) === 0)))
                    drawPieces(await api.get("torrents/pieceStates", { hash }).catch(() => null));
                else if (t.progress >= 1)
                    R.pieces.classList.add("hidden");
            }
            catch (e) {
                if (e.status === 404) {
                    toast(T("The torrent no longer exists"));
                    page.close();
                    return;
                }
            }
            if (alive)
                timer = setTimeout(refresh, (tab === "trackers") ? 5000 : 2500);
        };

        renderSeg();
        renderHero();
        refresh(true);
    };

    // =====================================================================
    // Vista: Buscar (motor de búsqueda de qBittorrent)
    // =====================================================================
    const SV = { plugins: null, id: null, results: [], status: "", total: 0, timer: null };
    const buildSearchView = () => {
        const el = h(`<section class="view hidden" data-view="search">
            <div class="safe-top"></div>
            <div class="main" data-ref="main">
                <div class="head"><h1>${T("Search")}</h1><button class="icon-btn" data-ref="pluginsBtn" aria-label="${T("Search plugins")}">${ic("plug")}</button></div>
                <form data-ref="form" style="margin-top:10px">
                    <label class="searchbar" style="margin-top:0">${ic("search", "sm")}<input type="search" data-ref="q" placeholder="${T("What do you want to search for?")}" autocomplete="off" enterkeyhint="search"><button class="icon-btn plain" data-ref="go" style="width:34px;height:34px" aria-label="${T("Search")}">${ic("chev", "sm")}</button></label>
                    <div class="row2" style="margin-top:10px">
                        <div class="field" style="margin:0"><select data-ref="cat"><option value="all">${T("All§f")}</option></select></div>
                        <div class="field" style="margin:0"><select data-ref="plug"><option value="enabled">${T("Enabled§plugins")}</option><option value="all">${T("All")}</option></select></div>
                    </div>
                </form>
                <div class="status-line hidden" data-ref="statusEl"></div>
                <div class="tools hidden" data-ref="tools">
                    <label class="searchbar">${ic("filter", "sm")}<input type="search" data-ref="fq" placeholder="${T("Filter results")}"></label>
                    <div class="field" style="margin:0;flex-shrink:0"><select data-ref="sort" style="width:auto"><option value="nbSeeders">${T("Seeds")}</option><option value="fileSize">${T("Size")}</option><option value="nbLeechers">${T("Peers")}</option><option value="fileName">${T("Name")}</option></select></div>
                </div>
                <div data-ref="list"></div>
            </div>
        </section>`);
        Object.assign(SV, refs(el));
        SV.form.addEventListener("submit", (e) => {
            e.preventDefault();
            SV.q.blur();
            startSearch();
        });
        SV.pluginsBtn.addEventListener("click", pluginsPage);
        SV.fq.addEventListener("input", renderResults);
        SV.sort.addEventListener("change", renderResults);
        pressable(SV.list, ".sres", {
            onTap: (el) => {
                const r = SV.results[Number(el.dataset.i)];
                if (!r)
                    return;
                menuSheet({
                    title: r.fileName,
                    subtitle: `${fmtBytes(r.fileSize)} · ${r.nbSeeders} ${T("seeds")} · ${r.engineName || hostOf(r.siteUrl)}`,
                    items: [
                        { icon: "download", label: T("Download…"), onClick: () => addSheet({ url: r.fileUrl }) },
                        { icon: "globe", label: T("Open description page"), hidden: !r.descrLink, onClick: () => window.open(r.descrLink, "_blank", "noopener") },
                        { icon: "copy", label: T("Copy link"), onClick: () => copyText(r.fileUrl, T("Link copied")) }
                    ]
                });
            }
        });
        return el;
    };

    const loadPlugins = async () => {
        try {
            SV.plugins = await api.get("search/plugins");
        }
        catch {
            SV.plugins = [];
        }
        const cats = new Map();
        for (const p of SV.plugins.filter((x) => x.enabled)) {
            for (const c of p.supportedCategories || []) {
                const id = (typeof c === "string") ? c : c.id;
                const name = (typeof c === "string") ? c : c.name;
                if (id !== "all")
                    cats.set(id, name);
            }
        }
        const curCat = SV.cat.value;
        SV.cat.innerHTML = `<option value="all">${T("All§f")}</option>${[...cats].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("")}`;
        SV.cat.value = cats.has(curCat) ? curCat : "all";
        const curPlug = SV.plug.value;
        SV.plug.innerHTML = `<option value="enabled">${T("Enabled§plugins")}</option><option value="all">${T("All")}</option>${SV.plugins.map((p) => `<option value="${esc(p.name)}">${esc(p.fullName)}</option>`).join("")}`;
        SV.plug.value = [...SV.plug.options].some((o) => o.value === curPlug) ? curPlug : "enabled";
        if (!SV.results.length && !SV.id)
            renderResults();
    };

    const startSearch = async () => {
        const pattern = SV.q.value.trim();
        if (!pattern)
            return;
        if (SV.id) {
            api.post("search/stop", { id: SV.id }).catch(() => {});
            api.post("search/delete", { id: SV.id }).catch(() => {});
        }
        SV.results = [];
        SV.id = null;
        SV.list._k = null;
        SV.list.innerHTML = "";
        try {
            const r = await api.post("search/start", { pattern, plugins: SV.plug.value, category: SV.cat.value });
            SV.id = r.id;
            SV.status = "Running";
            renderResults();
            pollSearch();
        }
        catch (e) {
            toast(e.message || T("Could not start the search"), "err");
        }
    };

    const pollSearch = async () => {
        clearTimeout(SV.timer);
        if (!SV.id)
            return;
        try {
            const d = await api.get("search/results", { id: SV.id, limit: 500, offset: SV.results.length });
            SV.results.push(...(d.results || []));
            SV.status = d.status;
            SV.total = d.total;
            renderResults();
        }
        catch {}
        if (SV.status === "Running")
            SV.timer = setTimeout(pollSearch, 1500);
    };

    const renderResults = () => {
        const running = SV.status === "Running";
        const st = SV.statusEl;
        st.classList.toggle("hidden", !SV.id);
        st.innerHTML = running
            ? `<span class="spinner"></span><span style="flex:1">${T("Searching… {0} results", SV.results.length)}</span><button class="sec-btn" data-stop>${ic("x", "sm")}${T("Stop")}</button>`
            : `<span style="flex:1">${T("{0} results", SV.results.length)}</span>`;
        st.querySelector("[data-stop]")?.addEventListener("click", async () => {
            await api.post("search/stop", { id: SV.id }).catch(() => {});
            SV.status = "Stopped";
            renderResults();
        });
        SV.tools.classList.toggle("hidden", !SV.results.length);

        if (!SV.id) {
            const noPlugins = SV.plugins && !SV.plugins.length;
            SV.list.innerHTML = noPlugins
                ? `<div class="empty">${ic("plug")}<b>${T("No search plugins")}</b><span>${T("qBittorrent's search engine needs plugins (and Python installed on the server).")}</span><button class="sec-btn" data-plugins>${ic("plus", "sm")}${T("Install plugins")}</button></div>`
                : `<div class="empty">${ic("search")}<b>${T("Search your favorite sites")}</b><span>${T("Uses the search plugins installed in qBittorrent.")}</span></div>`;
            SV.list.querySelector("[data-plugins]")?.addEventListener("click", pluginsPage);
            return;
        }
        const fq = SV.fq.value.trim().toLowerCase();
        const key = SV.sort.value;
        let list = SV.results.map((r, i) => Object.assign({ i }, r));
        if (fq)
            list = list.filter((r) => r.fileName.toLowerCase().includes(fq));
        list.sort((a, b) => ((key === "fileName") ? collator.compare(a.fileName, b.fileName) : ((b[key] || 0) - (a[key] || 0))));
        list = list.slice(0, 400);
        if (!list.length) {
            SV.list._k = null;
            SV.list.innerHTML = running ? "" : `<div class="empty">${ic("search")}<b>${T("No results")}</b></div>`;
            return;
        }
        if (!SV.list._k)
            SV.list.innerHTML = "";
        keyed(SV.list, list, (r) => r.i, () => h("<div class=\"sres\"><div class=\"name\"></div><div class=\"meta\"></div></div>"), (el, r) => {
            if (el._done)
                return;
            el._done = true;
            el.dataset.i = r.i;
            el.querySelector(".name").textContent = r.fileName;
            el.querySelector(".meta").innerHTML = `<span>${fmtBytes(r.fileSize)}</span><span class="seeders">${ic("up", "xs")}${(r.nbSeeders >= 0) ? r.nbSeeders : "?"}</span><span class="leechers">${ic("down", "xs")}${(r.nbLeechers >= 0) ? r.nbLeechers : "?"}</span><span class="push">${esc(r.engineName || hostOf(r.siteUrl))}</span>${r.pubDate ? `<span>${esc(fmtDate(r.pubDate))}</span>` : ""}`;
        });
    };

    const pluginsPage = () => {
        const page = openPage({ title: T("Plugins"), actions: `<button class="icon-btn" data-ref="upd" aria-label="${T("Update plugins")}">${ic("refresh")}</button>` });
        const render = async () => {
            await loadPlugins();
            if (page.closed)
                return;
            page.r.main.innerHTML = `
                <div class="group">${SV.plugins.length ? SV.plugins.map((p) => `
                    <div class="item" data-p="${esc(p.name)}">
                        <span class="lbl">${esc(p.fullName)}<small>v${esc(p.version)} · ${esc(hostOf(p.url))}</small></span>
                        <span class="switch"><input type="checkbox" data-en="${esc(p.name)}" ${p.enabled ? "checked" : ""}><i></i></span>
                        <button class="icon-btn plain" data-del="${esc(p.name)}" aria-label="${T("Uninstall")}">${ic("trash", "sm")}</button>
                    </div>`).join("") : "<div class=\"item\"><span class=\"lbl\" style=\"color:var(--text-faint)\">" + T("No plugins installed") + "</span></div>"}
                </div>
                <button class="btn primary" data-install>${ic("plus", "sm")} ${T("Install from URL")}</button>
                <p class="note" style="margin-top:12px">${T("Find plugins at github.com/qbittorrent/search-plugins/wiki. Requires Python on the server.")}</p>`;
        };
        page.r.main.addEventListener("change", async (e) => {
            const cb = e.target.closest("[data-en]");
            if (cb)
                await run(api.post("search/enablePlugin", { names: cb.dataset.en, enable: String(cb.checked) }), cb.checked ? T("Enabled") : T("Disabled"));
        });
        page.r.main.addEventListener("click", async (e) => {
            const del = e.target.closest("[data-del]");
            if (del) {
                if (await confirmSheet({ title: T("Uninstall plugin?"), message: del.dataset.del, ok: T("Uninstall"), danger: true })) {
                    await run(api.post("search/uninstallPlugin", { names: del.dataset.del }), T("Uninstalled"));
                    setTimeout(render, 800);
                }
                return;
            }
            if (e.target.closest("[data-install]")) {
                const v = await promptSheet({ title: T("Install plugin"), label: T("URL or path of the .py file"), type: "url", placeholder: "https://…/plugin.py", ok: T("Install") });
                if (v && v.trim()) {
                    await run(api.post("search/installPlugin", { sources: v.trim() }), T("Installing…"));
                    setTimeout(render, 2500);
                }
            }
        });
        page.r.upd.addEventListener("click", async () => {
            await run(api.post("search/updatePlugins"), T("Checking for updates…"));
            setTimeout(render, 3000);
        });
        page.r.main.innerHTML = "<div class=\"fetching\"><span class=\"spinner\"></span></div>";
        render();
    };

    // =====================================================================
    // Vista: RSS
    // =====================================================================
    const RV = { items: null };
    const buildRssView = () => {
        const el = h(`<section class="view hidden" data-view="rss">
            <div class="safe-top"></div>
            <div class="main" data-ref="main">
                <div class="head"><h1>RSS</h1>
                    <button class="icon-btn" data-ref="refresh" aria-label="${T("Refresh all")}">${ic("refresh")}</button>
                    <button class="icon-btn" data-ref="add" aria-label="${T("Add feed")}">${ic("plus")}</button>
                </div>
                <div data-ref="body" style="margin-top:10px"><div class="fetching"><span class="spinner"></span></div></div>
            </div>
        </section>`);
        Object.assign(RV, refs(el));
        RV.refresh.addEventListener("click", async () => {
            const feeds = flatFeeds(RV.items || {});
            await Promise.all(feeds.map((f) => api.post("rss/refreshItem", { itemPath: f.path }).catch(() => {})));
            toast(T("Refreshing feeds…"), "ok");
            setTimeout(loadRss, 2500);
        });
        RV.add.addEventListener("click", () => menuSheet({
            title: T("Add"),
            items: [
                {
                    icon: "rss",
                    label: T("New RSS feed…"),
                    onClick: async () => {
                        const v = await promptSheet({ title: T("New RSS feed"), label: T("Feed URL"), type: "url", placeholder: "https://…/rss", ok: T("Add") });
                        if (v && v.trim()) {
                            await run(api.post("rss/addFeed", { url: v.trim(), path: "" }), T("Feed added"));
                            setTimeout(loadRss, 1500);
                        }
                    }
                },
                {
                    icon: "folder",
                    label: T("New folder…"),
                    onClick: async () => {
                        const v = await promptSheet({ title: T("New folder"), label: T("Name"), ok: T("Create") });
                        if (v && v.trim()) {
                            await run(api.post("rss/addFolder", { path: v.trim() }), T("Folder created"));
                            loadRss();
                        }
                    }
                }
            ]
        }));
        pressable(RV.body, "[data-feed]", {
            onTap: (row) => openFeed(row.dataset.feed),
            onLong: (row) => feedMenu(row.dataset.feed)
        });
        RV.body.addEventListener("click", (e) => {
            if (e.target.closest("[data-rules]"))
                rulesPage();
            if (e.target.closest("[data-enable]"))
                setPrefs({ rss_processing_enabled: true }, T("RSS reader enabled")).then(renderRss);
        });
        return el;
    };

    const isFeed = (o) => !!o && (typeof o === "object") && (typeof o.uid === "string") && (typeof o.url === "string");
    const flatFeeds = (node, prefix = "", depth = 0, out = []) => {
        for (const [name, v] of Object.entries(node)) {
            const path = prefix ? `${prefix}\\${name}` : name;
            if (isFeed(v))
                out.push({ name, path, feed: v, depth });
            else if (v && (typeof v === "object"))
                out.push({ name, path, folder: true, depth }, ...flatFeeds(v, path, depth + 1, []));
        }
        return out;
    };
    const findFeed = (path) => flatFeeds(RV.items || {}).find((f) => f.path === path && !f.folder);

    const loadRss = async () => {
        try {
            RV.items = await api.get("rss/items", { withData: "true" });
        }
        catch {
            RV.items = RV.items || {};
        }
        renderRss();
    };

    const renderRss = () => {
        const list = flatFeeds(RV.items || {});
        const procOff = S.prefs.rss_processing_enabled === false;
        const unread = (f) => (f.feed.articles || []).filter((a) => !a.isRead).length;
        RV.body.innerHTML = `
            ${procOff ? `<div class="group"><div class="item"><span class="ico red">${ic("info", "sm")}</span><span class="lbl">${T("The RSS reader is disabled")}<small>${T("qBittorrent won't refresh the feeds.")}</small></span><button class="sec-btn" data-enable>${T("Enable")}</button></div></div>` : ""}
            ${list.length ? `<div class="group">${list.map((f) => f.folder
                ? `<div class="item" style="padding-left:${14 + f.depth * 16}px"><span class="ico accent">${ic("folder", "sm")}</span><span class="lbl"><b>${esc(f.name)}</b></span></div>`
                : `<button class="item" data-feed="${esc(f.path)}" style="padding-left:${14 + f.depth * 16}px">
                    <span class="ico ${f.feed.hasError ? "red" : "accent"}">${f.feed.isLoading ? "<span class=\"spinner\" style=\"width:14px;height:14px\"></span>" : ic("rss", "sm")}</span>
                    <span class="lbl">${esc(f.feed.title || f.name)}<small>${esc(f.feed.hasError ? T("Failed to refresh") : `${T("{0} articles", (f.feed.articles || []).length)}${f.feed.lastBuildDate ? ` · ${f.feed.lastBuildDate}` : ""}`)}</small></span>
                    ${unread(f) ? `<span class="badge">${unread(f)}</span>` : ""}
                    <span class="chev">${ic("chev", "sm")}</span>
                </button>`).join("")}</div>`
                : `<div class="empty">${ic("rss")}<b>${T("No RSS feeds")}</b><span>${T("Add a feed with the + button.")}</span></div>`}
            <div class="group-title">${T("Automation")}</div>
            <div class="group"><button class="item" data-rules><span class="ico">${ic("sparkles", "sm")}</span><span class="lbl">${T("Auto-download rules")}</span><span class="chev">${ic("chev", "sm")}</span></button></div>`;
    };

    const feedMenu = (path) => {
        const f = findFeed(path);
        if (!f)
            return;
        menuSheet({
            title: f.feed.title || f.name,
            subtitle: f.feed.url,
            items: [
                { icon: "refresh", label: T("Refresh"), onClick: async () => {
                    await run(api.post("rss/refreshItem", { itemPath: path }), T("Updating…"));
                    setTimeout(loadRss, 2000);
                } },
                { icon: "checkAll", label: T("Mark all as read"), onClick: async () => {
                    await run(api.post("rss/markAsRead", { itemPath: path }), T("Marked as read"));
                    loadRss();
                } },
                { icon: "edit", label: T("Rename…"), onClick: async () => {
                    const v = await promptSheet({ title: T("Rename feed"), value: f.name });
                    if (v && v.trim() && (v.trim() !== f.name)) {
                        const parent = path.includes("\\") ? path.slice(0, path.lastIndexOf("\\") + 1) : "";
                        await run(api.post("rss/moveItem", { itemPath: path, destPath: parent + v.trim() }), T("Renamed§f"));
                        loadRss();
                    }
                } },
                { icon: "link", label: T("Edit URL…"), onClick: async () => {
                    const v = await promptSheet({ title: T("Feed URL"), value: f.feed.url, type: "url" });
                    if (v && v.trim() && (v.trim() !== f.feed.url)) {
                        await run(api.post("rss/setFeedURL", { path, url: v.trim() }), T("URL updated"));
                        loadRss();
                    }
                } },
                { icon: "copy", label: T("Copy URL"), onClick: () => copyText(f.feed.url) },
                { icon: "trash", label: T("Delete feed"), danger: true, onClick: async () => {
                    if (await confirmSheet({ title: T("Delete feed?"), message: f.feed.title || f.name, ok: T("Delete"), danger: true })) {
                        await run(api.post("rss/removeItem", { path }), T("Feed deleted"));
                        loadRss();
                    }
                } }
            ]
        });
    };

    const openFeed = (path) => {
        let f = findFeed(path);
        if (!f)
            return;
        const page = openPage({
            title: f.feed.title || f.name,
            actions: `<button class="icon-btn" data-ref="read" aria-label="${T("Mark all as read")}">${ic("checkAll")}</button><button class="icon-btn" data-ref="menu" aria-label="${T("Options")}">${ic("more")}</button>`
        });
        const render = () => {
            f = findFeed(path) || f;
            const arts = [...(f.feed.articles || [])].sort((a, b) => (new Date(b.date) - new Date(a.date)));
            page.r.main.innerHTML = arts.length
                ? `<div class="group">${arts.map((a) => `<div class="article ${a.isRead ? "read" : "unread"}" data-art="${esc(a.id)}"><div class="t">${esc(a.title)}</div><small>${esc(a.date ? new Date(a.date).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "")}${a.author ? ` · ${esc(a.author)}` : ""}</small></div>`).join("")}</div>`
                : `<div class="empty">${ic("rss")}<b>${T("No articles")}</b></div>`;
        };
        render();
        page.r.read.addEventListener("click", async () => {
            await run(api.post("rss/markAsRead", { itemPath: path }), T("Marked as read"));
            for (const a of f.feed.articles || [])
                a.isRead = true;
            render();
            renderRss();
        });
        page.r.menu.addEventListener("click", () => feedMenu(path));
        pressable(page.r.main, "[data-art]", {
            onTap: (el) => {
                const a = (f.feed.articles || []).find((x) => String(x.id) === el.dataset.art);
                if (!a)
                    return;
                if (!a.isRead) {
                    a.isRead = true;
                    api.post("rss/markAsRead", { itemPath: path, articleId: a.id }).catch(() => {});
                    el.classList.replace("unread", "read");
                    renderRss();
                }
                const desc = plainText(a.description);
                const body = h(`<div>
                    ${desc ? `<div class="desc" style="white-space:pre-wrap">${esc(desc)}</div>` : ""}
                    <div class="btns" style="flex-direction:column">
                        ${(a.torrentURL || a.link) ? `<button class="btn primary" data-dl>${ic("download", "sm")} ${T("Download§verb")}</button>` : ""}
                        ${a.link ? `<button class="btn" data-open>${ic("globe", "sm")} ${T("Open link")}</button>` : ""}
                    </div>
                </div>`);
                const sheet = openSheet({ title: a.title, subtitle: a.date ? new Date(a.date).toLocaleString(LOCALE) : "", body });
                body.querySelector("[data-dl]")?.addEventListener("click", () => {
                    sheet.close({ handoff: true });
                    addSheet({ url: a.torrentURL || a.link });
                });
                body.querySelector("[data-open]")?.addEventListener("click", () => window.open(a.link, "_blank", "noopener"));
            }
        });
    };

    const rulesPage = () => {
        const page = openPage({ title: T("Automatic rules") });
        const render = async () => {
            let rules = {};
            try {
                rules = await api.get("rss/rules");
            }
            catch {}
            if (page.closed)
                return;
            const names = Object.keys(rules).sort(collator.compare);
            page.r.main.innerHTML = `
                ${names.length ? `<div class="group">${names.map((n) => {
                    const r = rules[n];
                    return `<div class="item"><span class="lbl">${esc(n)}<small>${esc([r.mustContain && T("Contains: {0}", r.mustContain), r.assignedCategory && T("Category: {0}", r.assignedCategory)].filter(Boolean).join(" · ") || T("No filter"))}</small></span><span class="switch"><input type="checkbox" data-rule="${esc(n)}" ${r.enabled ? "checked" : ""}><i></i></span></div>`;
                }).join("")}</div>` : `<div class="empty">${ic("sparkles")}<b>${T("No rules")}</b></div>`}
                <p class="note" style="margin-top:4px">${T("To create or edit rules in detail, use the desktop version (More → Desktop version).")}</p>`;
            page.r.main.onchange = async (e) => {
                const cb = e.target.closest("[data-rule]");
                if (!cb)
                    return;
                const def = Object.assign({}, rules[cb.dataset.rule], { enabled: cb.checked });
                const ok = await run(api.post("rss/setRule", { ruleName: cb.dataset.rule, ruleDef: JSON.stringify(def) }), cb.checked ? T("Rule enabled") : T("Rule disabled"));
                if (ok !== null)
                    rules[cb.dataset.rule] = def;
            };
        };
        page.r.main.innerHTML = "<div class=\"fetching\"><span class=\"spinner\"></span></div>";
        render();
    };

    // =====================================================================
    // Vista: Más (estadísticas, velocidad, opciones)
    // =====================================================================
    const MV = {};
    const PREF_GROUPS = [
        {
            title: T("Downloads"),
            items: [
                { type: "text", key: "save_path", label: T("Default save path"), icon: "folder" },
                { type: "bool", key: "temp_path_enabled", label: T("Separate path for incomplete torrents") },
                { type: "text", key: "temp_path", label: T("Incomplete path"), dep: "temp_path_enabled" },
                { type: "bool", key: "add_stopped_enabled", label: T("Add torrents stopped") },
                { type: "bool", key: "auto_tmm_enabled", label: T("Automatic management by default") },
                { type: "choice", key: "torrent_content_layout", label: T("Content layout"), options: [["Original", "Original"], ["Subfolder", T("Create subfolder")], ["NoSubfolder", T("Don't create subfolder")]] },
                { type: "bool", key: "preallocate_all", label: T("Pre-allocate disk space") },
                { type: "bool", key: "incomplete_files_ext", label: T("Append .!qB to incomplete files") }
            ]
        },
        {
            title: T("Queue"),
            items: [
                { type: "bool", key: "queueing_enabled", label: T("Use torrent queueing") },
                { type: "int", key: "max_active_downloads", label: T("Max active downloads"), dep: "queueing_enabled", hint: T("-1 = unlimited") },
                { type: "int", key: "max_active_uploads", label: T("Max active uploads"), dep: "queueing_enabled", hint: T("-1 = unlimited") },
                { type: "int", key: "max_active_torrents", label: T("Max active torrents"), dep: "queueing_enabled", hint: T("-1 = unlimited") },
                { type: "bool", key: "dont_count_slow_torrents", label: T("Don't count slow torrents"), dep: "queueing_enabled" }
            ]
        },
        {
            title: T("Seeding§group"),
            items: [
                { type: "bool", key: "max_ratio_enabled", label: T("Limit ratio") },
                { type: "float", key: "max_ratio", label: T("Maximum ratio"), dep: "max_ratio_enabled" },
                { type: "bool", key: "max_seeding_time_enabled", label: T("Limit seeding time") },
                { type: "int", key: "max_seeding_time", label: T("Seeding minutes"), dep: "max_seeding_time_enabled", unit: "min" },
                { type: "choice", key: "max_ratio_act", label: T("When the limit is reached"), options: [[0, T("Stop torrent")], [1, T("Remove torrent")], [3, T("Remove torrent and files")], [2, T("Enable super seeding")]] }
            ]
        },
        {
            title: T("Connection"),
            items: [
                { type: "int", key: "listen_port", label: T("Listening port") },
                { type: "bool", key: "upnp", label: "UPnP / NAT-PMP" },
                { type: "int", key: "max_connec", label: T("Max global connections"), hint: T("-1 = unlimited") },
                { type: "int", key: "max_connec_per_torrent", label: T("Max connections per torrent"), hint: T("-1 = unlimited") },
                { type: "bool", key: "dht", label: T("DHT (decentralized network)") },
                { type: "bool", key: "pex", label: T("Peer exchange (PeX)") },
                { type: "bool", key: "lsd", label: T("Local peer discovery (LSD)") },
                { type: "choice", key: "encryption", label: T("Encryption"), options: [[0, T("Allow")], [1, T("Require")], [2, T("Disable")]] },
                { type: "bool", key: "anonymous_mode", label: T("Anonymous mode") }
            ]
        }
    ];

    const buildMoreView = () => {
        const el = h(`<section class="view hidden" data-view="more">
            <div class="safe-top"></div>
            <div class="main" data-ref="main">
                <div class="head"><h1>${T("More")}</h1></div>
                <div data-ref="body" style="margin-top:12px"></div>
            </div>
        </section>`);
        Object.assign(MV, refs(el));
        MV.body.addEventListener("change", async (e) => {
            const cb = e.target.closest("[data-pref]");
            if (cb) {
                await setPrefs({ [cb.dataset.pref]: cb.checked });
                renderMore();
                return;
            }
            const alt = e.target.closest("[data-alt]");
            if (alt) {
                const ok = await run(api.post("transfer/toggleSpeedLimitsMode"), alt.checked ? T("Alternative speed limits on") : T("Alternative speed limits off"));
                if (ok !== null)
                    S.server.use_alt_speed_limits = alt.checked;
                renderMore();
            }
        });
        MV.body.addEventListener("click", async (e) => {
            const it = e.target.closest("[data-edit]");
            if (it) {
                editPref(it.dataset.edit);
                return;
            }
            const a = e.target.closest("[data-go]");
            if (!a)
                return;
            switch (a.dataset.go) {
                case "categories": categoriesPage(); break;
                case "tags": tagsPage(); break;
                case "log": logPage(); break;
                case "desktop":
                    try {
                        localStorage.setItem("penumbra.ui", "desktop");
                    }
                    catch {}
                    location.href = "./";
                    break;
                case "about": aboutSheet(); break;
                case "logout":
                    if (await confirmSheet({ title: T("Log out?"), ok: T("Log out") })) {
                        await api.post("auth/logout").catch(() => {});
                        location.reload();
                    }
                    break;
                case "shutdown":
                    if (await confirmSheet({ title: T("Shut down qBittorrent?"), message: T("qBittorrent will quit on the server. You'll have to start it again manually."), ok: T("Shut down"), danger: true })) {
                        await api.post("app/shutdown").catch(() => {});
                        clearTimeout(syncTimer);
                        $("#app").innerHTML = `<div class="login"><div class="empty">${ic("power")}<b>${T("qBittorrent has been shut down")}</b></div></div>`;
                    }
                    break;
            }
        });
        return el;
    };

    const PREF_INDEX = {};
    for (const g of PREF_GROUPS) {
        for (const it of g.items)
            PREF_INDEX[it.key] = it;
    }
    Object.assign(PREF_INDEX, {
        dl_limit: { type: "speed", key: "dl_limit", label: T("Global download limit") },
        up_limit: { type: "speed", key: "up_limit", label: T("Global upload limit") },
        alt_dl_limit: { type: "speed", key: "alt_dl_limit", label: T("Alternative download limit") },
        alt_up_limit: { type: "speed", key: "alt_up_limit", label: T("Alternative upload limit") }
    });

    const prefValueText = (it) => {
        const v = S.prefs[it.key];
        if (v === undefined)
            return "—";
        switch (it.type) {
            case "speed": return fmtLimit(v);
            case "choice": return (it.options.find(([k]) => k === v) || [, String(v)])[1];
            case "int": return (v < 0) ? T("No limit") : `${v}${it.unit ? ` ${it.unit}` : ""}`;
            case "float": return (v < 0) ? T("No limit") : nf(v, 2);
            default: return String(v);
        }
    };

    const editPref = async (key) => {
        const it = PREF_INDEX[key];
        if (!it)
            return;
        const cur = S.prefs[key];
        let v;
        if (it.type === "choice") {
            v = await choiceSheet({ title: it.label, options: it.options.map(([value, label]) => ({ value, label })), selected: cur });
            if (v === undefined)
                return;
        }
        else if (it.type === "speed") {
            const s = await promptSheet({ title: it.label, label: T("KiB/s (0 = unlimited)"), value: String(Math.round((cur || 0) / 1024)), type: "number", inputmode: "numeric" });
            if (s === null)
                return;
            v = Math.round(Math.max(0, Number(s) || 0) * 1024);
        }
        else if ((it.type === "int") || (it.type === "float")) {
            const s = await promptSheet({ title: it.label, value: String(cur ?? ""), type: "number", inputmode: (it.type === "int") ? "numeric" : "decimal", hint: it.hint || "" });
            if ((s === null) || (s.trim() === ""))
                return;
            v = (it.type === "int") ? Math.round(Number(s)) : Number(s);
            if (Number.isNaN(v))
                return toast(T("Invalid number"), "err");
        }
        else {
            const s = await promptSheet({ title: it.label, value: String(cur ?? "") });
            if (s === null)
                return;
            v = s.trim();
        }
        if (await setPrefs({ [key]: v }))
            renderMore();
        kickSync();
    };

    const renderMore = () => {
        if (!MV.body)
            return;
        const s = S.server;
        const p = S.prefs;
        const conn = { connected: [T("Connected"), "green"], firewalled: [T("Firewalled"), "red"], disconnected: [T("Disconnected"), "red"] }[s.connection_status] || ["—", ""];
        const prefRow = (it) => {
            if (it.dep && !p[it.dep])
                return "";
            if (it.type === "bool")
                return `<label class="item"><span class="lbl">${esc(it.label)}</span><span class="switch"><input type="checkbox" data-pref="${it.key}" ${p[it.key] ? "checked" : ""}><i></i></span></label>`;
            return `<button class="item" data-edit="${it.key}"><span class="lbl">${esc(it.label)}</span><span class="val ${(it.type === "text") ? "mono" : ""}">${esc(prefValueText(it))}</span><span class="chev">${ic("chev", "sm")}</span></button>`;
        };
        const sc = MV.main.scrollTop;
        MV.body.innerHTML = `
            <div class="stats">
                <div class="stat"><small>${T("Download · session")}</small><b>${fmtBytes(s.dl_info_data)}</b></div>
                <div class="stat"><small>${T("Upload · session")}</small><b>${fmtBytes(s.up_info_data)}</b></div>
                <div class="stat"><small>${T("Download · total")}</small><b>${fmtBytes(s.alltime_dl)}</b></div>
                <div class="stat"><small>${T("Upload · total")}</small><b>${fmtBytes(s.alltime_ul)}</b></div>
                <div class="stat"><small>${T("Global ratio")}</small><b>${esc(s.global_ratio ?? "—")}</b></div>
                <div class="stat"><small>${T("Free space")}</small><b>${fmtBytes(s.free_space_on_disk)}</b></div>
                <div class="stat"><small>${T("Connected peers")}</small><b>${s.total_peer_connections ?? "—"}</b></div>
                <div class="stat"><small>${T("DHT nodes")}</small><b>${s.dht_nodes ?? "—"}</b></div>
            </div>
            <div class="group"><div class="item"><span class="ico ${conn[1]}">${ic((s.connection_status === "disconnected") ? "wifiOff" : "wifi", "sm")}</span><span class="lbl">${T("Connection status")}<small>${esc(s.last_external_address_v4 || s.last_external_address_v6 || "")}</small></span><span class="val">${esc(conn[0])}</span></div></div>

            <div class="group-title">${T("Speed")}</div>
            <div class="group">
                <label class="item"><span class="ico">${ic("snail", "sm")}</span><span class="lbl">${T("Alternative limits")}<small>${T("Download {0} · Upload {1}", esc(fmtLimit(p.alt_dl_limit)), esc(fmtLimit(p.alt_up_limit)))}</small></span><span class="switch"><input type="checkbox" data-alt ${s.use_alt_speed_limits ? "checked" : ""}><i></i></span></label>
                ${prefRow(PREF_INDEX.dl_limit)}
                ${prefRow(PREF_INDEX.up_limit)}
                ${prefRow(PREF_INDEX.alt_dl_limit)}
                ${prefRow(PREF_INDEX.alt_up_limit)}
                <label class="item"><span class="lbl">${T("Schedule alternative limits")}<small>${T("The schedule is set in the desktop version")}</small></span><span class="switch"><input type="checkbox" data-pref="scheduler_enabled" ${p.scheduler_enabled ? "checked" : ""}><i></i></span></label>
            </div>

            ${PREF_GROUPS.map((g) => `<div class="group-title">${esc(g.title)}</div><div class="group">${g.items.map(prefRow).join("")}</div>`).join("")}

            <div class="group-title">${T("Organize")}</div>
            <div class="group">
                <button class="item" data-go="categories"><span class="ico accent">${ic("folder", "sm")}</span><span class="lbl">${T("Categories")}</span><span class="val">${Object.keys(S.categories).length}</span><span class="chev">${ic("chev", "sm")}</span></button>
                <button class="item" data-go="tags"><span class="ico accent">${ic("tag", "sm")}</span><span class="lbl">${T("Tags")}</span><span class="val">${S.tags.length}</span><span class="chev">${ic("chev", "sm")}</span></button>
            </div>

            <div class="group-title">${T("Tools")}</div>
            <div class="group">
                <button class="item" data-go="log"><span class="ico">${ic("doc", "sm")}</span><span class="lbl">${T("Execution log")}</span><span class="chev">${ic("chev", "sm")}</span></button>
                <button class="item" data-go="desktop"><span class="ico blue">${ic("monitor", "sm")}</span><span class="lbl">${T("Desktop version")}<small>${T("All of qBittorrent's advanced options")}</small></span><span class="chev">${ic("chev", "sm")}</span></button>
                <button class="item" data-go="about"><span class="ico">${ic("info", "sm")}</span><span class="lbl">${T("About")}</span><span class="val">${esc(S.version)}</span></button>
            </div>

            <div class="group-title">${T("Session")}</div>
            <div class="group">
                <button class="item" data-go="logout"><span class="ico">${ic("logout", "sm")}</span><span class="lbl">${T("Log out")}</span></button>
                <button class="item danger" data-go="shutdown"><span class="ico red">${ic("power", "sm")}</span><span class="lbl">${T("Shut down qBittorrent")}</span></button>
            </div>`;
        MV.main.scrollTop = sc;
    };

    const categoriesPage = () => {
        const page = openPage({ title: T("Categories"), actions: `<button class="icon-btn" data-ref="add" aria-label="${T("New category")}">${ic("plus")}</button>` });
        const render = () => {
            const names = Object.keys(S.categories).sort(collator.compare);
            const counts = {};
            for (const t of S.torrents.values())
                counts[t.category] = (counts[t.category] || 0) + 1;
            page.r.main.innerHTML = names.length
                ? `<div class="group">${names.map((n) => `<button class="item" data-cat="${esc(n)}"><span class="ico accent">${ic("folder", "sm")}</span><span class="lbl">${esc(n)}<small class="mono">${esc(S.categories[n].savePath || T("Default save path"))}</small></span><span class="val">${counts[n] || 0}</span></button>`).join("")}</div>
                   <button class="sec-btn" data-unused>${ic("trash", "sm")}${T("Remove unused categories")}</button>`
                : `<div class="empty">${ic("folder")}<b>${T("No categories")}</b><span>${T("Categories help you organize and decide where each download is saved.")}</span></div>`;
        };
        render();
        const unsub = onSync(() => {
            if (page.closed)
                return unsub();
            if (!document.querySelector(".sheet-wrap"))
                render();
        });
        page.r.add.addEventListener("click", async () => {
            if (await categoryEditor())
                render();
        });
        page.r.main.addEventListener("click", async (e) => {
            if (e.target.closest("[data-unused]")) {
                const used = new Set([...S.torrents.values()].map((t) => t.category));
                const unused = Object.keys(S.categories).filter((c) => !used.has(c));
                if (!unused.length)
                    return toast(T("All categories are in use"));
                if (await confirmSheet({ title: T("Remove {0} unused categories?", unused.length), message: unused.join(", "), ok: T("Delete"), danger: true })) {
                    await run(api.post("torrents/removeCategories", { categories: unused.join("\n") }), T("Categories removed"));
                    for (const c of unused)
                        delete S.categories[c];
                    render();
                }
                return;
            }
            const b = e.target.closest("[data-cat]");
            if (!b)
                return;
            const n = b.dataset.cat;
            menuSheet({
                title: n,
                subtitle: S.categories[n]?.savePath || T("Default save path"),
                items: [
                    { icon: "filter", label: T("Show its torrents"), onClick: () => {
                        S.filter.category = n;
                        saveFilter();
                        page.close();
                        switchTab("torrents");
                    } },
                    { icon: "edit", label: T("Edit path…"), onClick: async () => {
                        if (await categoryEditor(n))
                            render();
                    } },
                    { icon: "plus", label: T("New subcategory…"), hidden: !S.prefs.use_subcategories, onClick: async () => {
                        const v = await promptSheet({ title: T("New subcategory"), label: T("Inside “{0}”", n), ok: T("Create") });
                        if (v && v.trim()) {
                            await run(api.post("torrents/createCategory", { category: `${n}/${v.trim()}`, savePath: "" }), T("Subcategory created"));
                            render();
                        }
                    } },
                    { icon: "trash", label: T("Remove category"), danger: true, onClick: async () => {
                        if (await confirmSheet({ title: T("Remove category?"), message: T("{0}. Its torrents will be left without a category.", n), ok: T("Delete"), danger: true })) {
                            await run(api.post("torrents/removeCategories", { categories: n }), T("Category removed"));
                            delete S.categories[n];
                            render();
                        }
                    } }
                ]
            });
        });
    };

    const tagsPage = () => {
        const page = openPage({ title: T("Tags"), actions: `<button class="icon-btn" data-ref="add" aria-label="${T("New tag")}">${ic("plus")}</button>` });
        const render = () => {
            const counts = {};
            for (const t of S.torrents.values()) {
                for (const tg of tagsOf(t))
                    counts[tg] = (counts[tg] || 0) + 1;
            }
            const tags = [...S.tags].sort(collator.compare);
            page.r.main.innerHTML = tags.length
                ? `<div class="group">${tags.map((tg) => `<button class="item" data-tag="${esc(tg)}"><span class="ico accent">${ic("tag", "sm")}</span><span class="lbl">${esc(tg)}</span><span class="val">${counts[tg] || 0}</span></button>`).join("")}</div>
                   <button class="sec-btn" data-unused>${ic("trash", "sm")}${T("Remove unused tags")}</button>`
                : `<div class="empty">${ic("tag")}<b>${T("No tags")}</b></div>`;
            page.counts = counts;
        };
        render();
        page.r.add.addEventListener("click", async () => {
            const v = await promptSheet({ title: T("New tag"), label: T("Name (separate several with commas)"), ok: T("Create") });
            if (v && v.trim()) {
                await run(api.post("torrents/createTags", { tags: v.trim() }), T("Tag created"));
                for (const tg of v.split(",").map((x) => x.trim()).filter(Boolean)) {
                    if (!S.tags.includes(tg))
                        S.tags.push(tg);
                }
                render();
            }
        });
        page.r.main.addEventListener("click", async (e) => {
            if (e.target.closest("[data-unused]")) {
                const unused = S.tags.filter((tg) => !page.counts[tg]);
                if (!unused.length)
                    return toast(T("All tags are in use"));
                if (await confirmSheet({ title: T("Remove {0} unused tags?", unused.length), message: unused.join(", "), ok: T("Delete"), danger: true })) {
                    await run(api.post("torrents/deleteTags", { tags: unused.join(",") }), T("Tags removed"));
                    S.tags = S.tags.filter((x) => !unused.includes(x));
                    render();
                }
                return;
            }
            const b = e.target.closest("[data-tag]");
            if (!b)
                return;
            const tg = b.dataset.tag;
            menuSheet({
                title: tg,
                items: [
                    { icon: "filter", label: T("Show its torrents"), onClick: () => {
                        S.filter.tag = tg;
                        saveFilter();
                        page.close();
                        switchTab("torrents");
                    } },
                    { icon: "trash", label: T("Remove tag"), danger: true, onClick: async () => {
                        if (await confirmSheet({ title: T("Remove tag?"), message: tg, ok: T("Delete"), danger: true })) {
                            await run(api.post("torrents/deleteTags", { tags: tg }), T("Tag removed"));
                            S.tags = S.tags.filter((x) => x !== tg);
                            render();
                        }
                    } }
                ]
            });
        });
    };

    const logPage = () => {
        const types = store.get("logTypes", { normal: true, info: true, warning: true, critical: true });
        let lines = [];
        let lastId = -1;
        let timer = null;
        const page = openPage({ title: T("Log"), onClose: () => clearTimeout(timer) });
        page.r.main.innerHTML = `<div class="chips" data-chips style="margin-top:0"></div><div class="group" data-lines style="margin-top:10px"></div>`;
        const chips = page.r.main.querySelector("[data-chips]");
        const box = page.r.main.querySelector("[data-lines]");
        const TYPES = [["normal", "Normal", 1], ["info", T("Information"), 2], ["warning", T("Warnings"), 4], ["critical", T("Critical"), 8]];
        const renderChips = () => {
            chips.innerHTML = TYPES.map(([k, l]) => `<button class="chip ${types[k] ? "soft" : ""}" data-k="${k}">${types[k] ? ic("check", "xs") : ""}${l}</button>`).join("");
        };
        chips.addEventListener("click", (e) => {
            const c = e.target.closest("[data-k]");
            if (!c)
                return;
            types[c.dataset.k] = !types[c.dataset.k];
            store.set("logTypes", types);
            renderChips();
            render();
        });
        const render = () => {
            const mask = TYPES.filter(([k]) => types[k]).reduce((a, [, , bit]) => a | bit, 0);
            const vis = lines.filter((l) => l.type & mask).slice(-400).reverse();
            box.innerHTML = vis.length
                ? vis.map((l) => `<div class="logline ${(l.type === 8) ? "crit" : ((l.type === 4) ? "warn" : ((l.type === 2) ? "info" : ""))}"><small>${new Date(l.timestamp * 1000).toLocaleString(LOCALE)}</small>${esc(l.message)}</div>`).join("")
                : "<div class=\"item\"><span class=\"lbl\" style=\"color:var(--text-faint)\">" + T("No messages") + "</span></div>";
        };
        const load = async () => {
            try {
                const d = await api.get("log/main", { normal: "true", info: "true", warning: "true", critical: "true", last_known_id: lastId });
                if (d.length) {
                    lines.push(...d);
                    lastId = d[d.length - 1].id;
                    if (lines.length > 2000)
                        lines = lines.slice(-2000);
                    render();
                }
                else if (lastId === -1) {
                    render();
                }
            }
            catch {}
            if (!page.closed)
                timer = setTimeout(load, 4000);
        };
        renderChips();
        load();
    };

    const aboutSheet = async () => {
        let build = {};
        let webapi = "";
        try {
            [build, webapi] = await Promise.all([api.get("app/buildInfo"), api.get("app/webapiVersion")]);
        }
        catch {}
        openSheet({
            title: "qBittorrent",
            subtitle: T("Penumbra mobile interface"),
            body: `<div class="group">
                <div class="item"><span class="lbl">${T("Version")}</span><span class="val">${esc(S.version)}</span></div>
                <div class="item"><span class="lbl">${T("Web API")}</span><span class="val">${esc(webapi)}</span></div>
                ${build.qt ? `<div class="item"><span class="lbl">Qt</span><span class="val">${esc(build.qt)}</span></div>` : ""}
                ${build.libtorrent ? `<div class="item"><span class="lbl">libtorrent</span><span class="val">${esc(build.libtorrent)}</span></div>` : ""}
                ${build.boost ? `<div class="item"><span class="lbl">Boost</span><span class="val">${esc(build.boost)}</span></div>` : ""}
                ${build.openssl ? `<div class="item"><span class="lbl">OpenSSL</span><span class="val">${esc(build.openssl)}</span></div>` : ""}
                ${build.platform ? `<div class="item"><span class="lbl">${T("Platform")}</span><span class="val">${esc(`${build.platform} ${build.bitness || ""}`)}</span></div>` : ""}
            </div>`
        });
    };

    // =====================================================================
    // Inicio de sesión
    // =====================================================================
    const showLogin = (msg = "") => {
        clearTimeout(syncTimer);
        document.body.classList.remove("selecting");
        const el = h(`<div class="login">
            <form>
                <img class="logo" src="images/qbittorrent-tray.svg" alt="">
                <h1>qBittorrent</h1>
                <p>${T("Sign in to continue")}</p>
                <div class="field"><label for="u">${T("Username")}</label><input id="u" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" required></div>
                <div class="field"><label for="pw">${T("Password")}</label><input id="pw" type="password" autocomplete="current-password" required></div>
                <button class="btn primary" style="margin-top:8px">${T("Sign in")}</button>
                <div class="err">${esc(msg)}</div>
            </form>
        </div>`);
        $("#app").replaceChildren(el);
        const form = el.querySelector("form");
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const btn = form.querySelector("button");
            btn.disabled = true;
            const err = form.querySelector(".err");
            err.textContent = "";
            try {
                const r = await fetch("api/v2/auth/login", { method: "POST", body: new URLSearchParams({ username: $("#u").value, password: $("#pw").value }) });
                const txt = await r.text();
                if (r.ok && (txt.trim() === "Ok.")) {
                    location.reload();
                    return;
                }
                err.textContent = (r.status === 403) ? T("Too many failed attempts. Your IP is temporarily banned.") : T("Invalid username or password.");
            }
            catch {
                err.textContent = T("Could not reach qBittorrent.");
            }
            btn.disabled = false;
            $("#pw").value = "";
            $("#pw").focus();
        });
    };
    onForbidden = () => {
        if (!$(".login"))
            showLogin(T("Your session expired. Please sign in again."));
    };

    // =====================================================================
    // Arranque y navegación por pestañas
    // =====================================================================
    const TABS = [["torrents", "Torrents", "transfer"], ["search", T("Search"), "search"], ["rss", "RSS", "rss"], ["more", T("More"), "settings"]];
    let views = {};
    const switchTab = (tab) => {
        if (S.selecting)
            setSelecting(false);
        const same = S.tab === tab;
        S.tab = tab;
        store.set("tab", tab);
        for (const [k, el] of Object.entries(views))
            el.classList.toggle("hidden", k !== tab);
        for (const b of document.querySelectorAll(".tabbar [data-tab]"))
            b.classList.toggle("active", b.dataset.tab === tab);
        const v = views[tab];
        if (same)
            v.querySelector(".main")?.scrollTo({ top: 0, behavior: "smooth" });
        if (tab === "torrents")
            renderTorrents();
        else if (tab === "search") {
            if (!SV.plugins)
                loadPlugins();
        }
        else if (tab === "rss") {
            loadPrefs().then(loadRss);
        }
        else if (tab === "more") {
            renderMore();
            loadPrefs().then(renderMore);
        }
    };

    const startApp = () => {
        const app = $("#app");
        app.innerHTML = "";
        views = {
            torrents: buildTorrentsView(),
            search: buildSearchView(),
            rss: buildRssView(),
            more: buildMoreView()
        };
        for (const v of Object.values(views))
            app.append(v);
        const bar = h(`<nav class="tabbar">${TABS.map(([k, l, i]) => `<button data-tab="${k}">${ic(i)}<span>${l}</span></button>`).join("")}</nav>`);
        bar.addEventListener("click", (e) => {
            const b = e.target.closest("[data-tab]");
            if (b)
                switchTab(b.dataset.tab);
        });
        app.append(bar);
        onSync(() => {
            if (S.tab === "torrents")
                renderTorrents();
            else if ((S.tab === "more") && !document.querySelector(".sheet-wrap"))
                renderMore();
        });
        switchTab(TABS.some(([k]) => k === S.tab) ? S.tab : "torrents");
        loadPrefs().then(() => {
            if (S.tab === "torrents")
                renderTorrents();
        });
        sync();

        // Compartir un enlace magnet a esta página: mobile.html?add=magnet:...
        const params = new URLSearchParams(location.search);
        const add = params.get("add") || params.get("magnet") || params.get("url");
        if (add) {
            history.replaceState(null, "", location.pathname);
            setTimeout(() => addSheet({ url: add }), 400);
        }
    };

    const boot = async () => {
        try {
            const r = await fetch("api/v2/app/version", { cache: "no-store" });
            if (r.status === 403)
                return showLogin();
            if (!r.ok)
                throw new Error(String(r.status));
            S.version = (await r.text()).trim();
            startApp();
        }
        catch {
            $("#app").innerHTML = `<div class="login"><div class="empty">${ic("wifiOff")}<b>${T("Can't connect to qBittorrent")}</b><span>${T("Retrying…")}</span></div></div>`;
            setTimeout(boot, 3000);
        }
    };

    boot();
})();
