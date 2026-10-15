(() => {
    let indicator = null;
    let activeLoads = 0;
    let hideTimer = null;

    function getIndicator() {
        if (indicator) return indicator;

        const style = document.createElement("style");
        style.textContent = `
            @property --page-load-progress{syntax:'<percentage>';inherits:false;initial-value:0%}
            .page-load-indicator{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;pointer-events:none}
            .page-load-indicator[hidden]{display:none!important}
            .page-load-ring{position:relative;width:176px;height:176px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:50%;background:conic-gradient(#dbeafe 0 100%);box-shadow:0 12px 34px rgba(15,23,42,.28),0 0 0 8px rgba(255,255,255,.52);font-family:'Segoe UI',sans-serif;color:#0f172a;transition:--page-load-progress .35s ease-out}
            .page-load-ring::before{content:"";position:absolute;inset:10px;border:1px solid rgba(255,255,255,.9);border-radius:50%;background:linear-gradient(155deg,#fff 0%,#f0fdfa 100%);box-shadow:inset 0 2px 8px rgba(255,255,255,.95),inset 0 -8px 18px rgba(37,99,235,.08)}
            .page-load-ring::after{content:"";position:absolute;inset:0;border:4px solid transparent;border-top-color:#2563eb;border-right-color:#10b981;border-radius:50%;animation:page-load-spin 1.4s cubic-bezier(.55,.1,.35,.9) infinite}
            .page-load-percent,.page-load-message{position:relative;z-index:1}
            .page-load-percent{font-size:30px;font-weight:900;line-height:1.1}
            .page-load-message{max-width:132px;margin-top:7px;color:#475569;font-size:13px;font-weight:700;text-align:center}
            @keyframes page-load-spin{to{transform:rotate(360deg)}}
            @media(max-width:600px){.page-load-ring{width:150px;height:150px}.page-load-ring::before{inset:9px}.page-load-percent{font-size:26px}.page-load-message{font-size:12px}}
            @media(prefers-reduced-motion:reduce){.page-load-ring,.page-load-ring::after{animation:none;transition:none}}
        `;
        document.head.appendChild(style);

        indicator = document.createElement("div");
        indicator.className = "page-load-indicator";
        indicator.hidden = true;
        indicator.setAttribute("role", "status");
        indicator.setAttribute("aria-live", "polite");
        indicator.innerHTML = '<div class="page-load-ring"><span class="page-load-percent">...</span><small class="page-load-message"></small></div>';
        document.body.appendChild(indicator);
        return indicator;
    }

    function begin(message) {
        const node = getIndicator();
        clearTimeout(hideTimer);
        activeLoads++;
        node.hidden = false;
        node.querySelector(".page-load-percent").textContent = "...";
        node.querySelector(".page-load-message").textContent = message;
        node.setAttribute("aria-label", message);

        let finished = false;
        return () => {
            if (finished) return;
            finished = true;
            activeLoads = Math.max(0, activeLoads - 1);
            if (activeLoads) return;

            node.querySelector(".page-load-percent").textContent = "100%";
            node.querySelector(".page-load-message").textContent = "Ready";
            hideTimer = window.setTimeout(() => { node.hidden = true; }, 650);
        };
    }

    async function run(message, task) {
        const finish = begin(message || "Loading...");
        const startedAt = performance.now();
        try {
            return await task();
        } finally {
            const remainingDisplayTime = 350 - (performance.now() - startedAt);
            if (remainingDisplayTime > 0) {
                await new Promise(resolve => window.setTimeout(resolve, remainingDisplayTime));
            }
            finish();
        }
    }

    window.pageLoading = { run };
})();
