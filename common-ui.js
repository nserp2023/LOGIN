document.addEventListener("DOMContentLoaded", function () {
    if (document.querySelector(".floating-dashboard-btn")) return;

    const btn = document.createElement("a");
    btn.href = "dashboard.html";
    btn.title = "Dashboard";
    btn.className = "floating-dashboard-btn";
    btn.textContent = "⌂";

    document.body.appendChild(btn);

    if (!document.getElementById("common-ui-style")) {
        const style = document.createElement("style");
        style.id = "common-ui-style";
        style.textContent = `
            .floating-dashboard-btn{
                position:fixed;
                top:10px;
                right:10px;
                width:42px;
                height:42px;
                display:flex;
                align-items:center;
                justify-content:center;
                background:#2563eb;
                color:#ffffff;
                text-decoration:none;
                font-size:22px;
                font-weight:bold;
                border-radius:10px;
                box-shadow:0 6px 18px rgba(0,0,0,0.25);
                z-index:99999;
                border:1px solid rgba(255,255,255,0.15);
                transition:all 0.2s ease;
            }

            .floating-dashboard-btn:hover{
                background:#1d4ed8;
                transform:scale(1.05);
            }

            .floating-dashboard-btn:active{
                transform:scale(0.96);
            }

            @media print{
                .floating-dashboard-btn{
                    display:none !important;
                }
            }

            @media (max-width:600px){
                .floating-dashboard-btn{
                    top:8px;
                    right:8px;
                    width:38px;
                    height:38px;
                    font-size:20px;
                }
            }
        `;
        document.head.appendChild(style);
    }
});