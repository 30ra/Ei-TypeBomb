(() => {
  if (window !== window.top || location.origin !== "https://ei-typebomb.com") return;

  function install() {
    const wrapper = document.createElement("div");
    wrapper.className = "rounded-lg w-fit";
    wrapper.dataset.cursor = "button";
    const button = document.createElement("button");
    button.type = "button";
    // Lucide ArrowLeft from the room UI (lucide-react 1.77.0).
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    for (const [key, value] of Object.entries({
      width: 24, height: 24, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", "stroke-width": 2.5, "stroke-linecap": "round",
      "stroke-linejoin": "round", "aria-hidden": "true",
    })) svg.setAttribute(key, value);
    for (const d of ["m12 19-7-7 7-7", "M19 12H5"]) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    button.append(svg);
    button.title = "前の画面に戻る";
    button.setAttribute("aria-label", "前の画面に戻る");
    button.className = "font-bold transition-all duration-(--duration-etb) ease-etb cursor-pointer w-full flex active:scale-95 rounded-lg pl-1.5 pr-1.5 py-1.5 gap-1 justify-center";
    wrapper.append(button);
    button.addEventListener("click", () => history.back());

    function update() {
      const parts = location.pathname.split("/").filter(Boolean);
      // Single-segment routes are room links or home feeds, except these static pages.
      const staticPages = ["account", "beta-access-denied", "server-url", "server-health",
        "sign-in", "sign-up", "terms-of-use"];
      if (!parts.length || (parts.length === 1 && !staticPages.includes(parts[0]))
          || (parts.length === 2 && ["offline", "online"].includes(parts[1]))
          || parts[0] === "viewer-feed-internal") {
        wrapper.remove();
        return;
      }
      const header = document.querySelector("header");
      const parent = header || document.body;
      if (!parent) return;
      if (wrapper.parentNode !== parent) parent.prepend(wrapper);
      wrapper.style.position = header ? "static" : "fixed";
      wrapper.style.bottom = "8px";
      wrapper.style.left = "8px";
      wrapper.style.zIndex = "100";
      button.disabled = !(window.navigation?.canGoBack ?? (history.length > 1));
      wrapper.dataset.cursorShape = button.disabled ? "2" : "1";
      button.style.opacity = button.disabled ? "0.5" : "1";
    }
    update();
    new MutationObserver(update).observe(document.documentElement, {childList:true, subtree:true});
    window.addEventListener("pageshow", update);
    window.addEventListener("popstate", update);
    window.navigation?.addEventListener("currententrychange", update);
  }
  if (document.readyState === "complete") install();
  else window.addEventListener("load", install, {once:true});
})();
