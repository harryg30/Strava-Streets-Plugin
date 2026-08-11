import type {
  CoverageStatus,
  LatLng,
  PanoLayout,
  StreetViewCredential,
} from "../../domain/types.js";
import type { StreetViewSurface } from "../../ports/index.js";

const ROOT_ID = "strava-streets-pano-root";
const VIEWPORT_ID = "strava-streets-pano-viewport";
const NOTICE_TEXT = "No Street View at this point";
const BRIDGE_REQUEST = "ssp-isolated";
const BRIDGE_SOURCE = "ssp-page-bridge";

type CloseListener = () => void;
type LayoutListener = (layout: PanoLayout) => void;

type BridgeResponse = {
  source: string;
  id?: string;
  type?: string;
  ok?: boolean;
  coverage?: CoverageStatus;
  error?: string;
};

/**
 * In-page Pano Window overlay. Chrome/DOM run in the isolated content script;
 * Maps JS runs in a page-world bridge (see maps-page-bridge.ts) because
 * injected <script src="maps…"> is invisible to the isolated world.
 */
export class MapsStreetViewSurface implements StreetViewSurface {
  private root: HTMLElement | null = null;
  private panoEl: HTMLElement | null = null;
  private noticeEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private layout: PanoLayout | null = null;
  private closeListeners = new Set<CloseListener>();
  private layoutListeners = new Set<LayoutListener>();
  private dragState: {
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null = null;
  private bridgeReady: Promise<void> | null = null;
  private pending = new Map<
    string,
    {
      resolve: (value: BridgeResponse) => void;
      reject: (err: Error) => void;
    }
  >();
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private reqSeq = 0;

  mount(layout: PanoLayout): void {
    if (this.root) return;
    this.layout = { ...layout };
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "ssp-pano";
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-label", "Street View Pano Window");
    applyLayout(root, layout);

    root.innerHTML = `
      <div class="ssp-pano__chrome">
        <div class="ssp-pano__title" data-drag-handle>Street View</div>
        <button type="button" class="ssp-pano__close" aria-label="Close Pano Window">×</button>
      </div>
      <div class="ssp-pano__body">
        <div class="ssp-pano__viewport" id="${VIEWPORT_ID}"></div>
        <div class="ssp-pano__notice" hidden>${NOTICE_TEXT}</div>
        <div class="ssp-pano__status" hidden></div>
      </div>
      <div class="ssp-pano__resize" aria-hidden="true"></div>
    `;

    document.documentElement.appendChild(root);
    this.root = root;
    this.panoEl = root.querySelector(".ssp-pano__viewport");
    this.noticeEl = root.querySelector(".ssp-pano__notice");
    this.statusEl = root.querySelector(".ssp-pano__status");

    root.querySelector(".ssp-pano__close")?.addEventListener("click", () => {
      for (const l of this.closeListeners) l();
    });

    this.wireDrag(root);
    this.wireResize(root);
    this.ensureMessageHandler();
    // Inject Maps bridge lazily on showAnchor — never block chrome mount.
  }

  unmount(): void {
    if (!this.root) return;
    void this.callBridge({ type: "destroyPanorama" }).catch(() => {
      /* bridge may already be gone */
    });
    this.root.remove();
    this.root = null;
    this.panoEl = null;
    this.noticeEl = null;
    this.statusEl = null;
  }

  isMounted(): boolean {
    return this.root !== null;
  }

  setLayout(layout: PanoLayout): void {
    this.layout = { ...layout };
    if (this.root) applyLayout(this.root, layout);
  }

  async showAnchor(
    point: LatLng,
    credential: StreetViewCredential,
  ): Promise<CoverageStatus> {
    if (!this.root || !this.panoEl) {
      return "coverage_gap";
    }

    await this.ensureBridge();

    const response = await this.callBridge({
      type: "showAnchor",
      apiKey: credential.apiKey,
      viewportId: VIEWPORT_ID,
      point,
    });

    if (!response.ok) {
      throw new Error(response.error ?? "Street View bridge failed");
    }

    return response.coverage === "covered" ? "covered" : "coverage_gap";
  }

  setCoverageGapNotice(visible: boolean): void {
    if (!this.noticeEl) return;
    this.noticeEl.hidden = !visible;
  }

  setStatusMessage(message: string | null): void {
    if (!this.statusEl) return;
    if (!message) {
      this.statusEl.hidden = true;
      this.statusEl.textContent = "";
      return;
    }
    this.statusEl.hidden = false;
    this.statusEl.textContent = message;
  }

  onUserClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  onLayoutChange(listener: LayoutListener): () => void {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  private ensureMessageHandler(): void {
    if (this.messageHandler) return;
    this.messageHandler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as BridgeResponse | null;
      if (!data || data.source !== BRIDGE_SOURCE) return;

      if (data.type === "ready") return;

      if (data.id && this.pending.has(data.id)) {
        const entry = this.pending.get(data.id)!;
        this.pending.delete(data.id);
        entry.resolve(data);
      }
    };
    window.addEventListener("message", this.messageHandler);
  }

  private ensureBridge(): Promise<void> {
    if (this.bridgeReady) return this.bridgeReady;

    this.ensureMessageHandler();

    this.bridgeReady = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onReady);
        window.clearTimeout(timer);
        if (err) {
          this.bridgeReady = null;
          reject(err);
        } else {
          resolve();
        }
      };

      const onReady = (event: MessageEvent) => {
        const data = event.data as BridgeResponse | null;
        if (event.source !== window) return;
        if (!data || data.source !== BRIDGE_SOURCE || data.type !== "ready") {
          return;
        }
        finish();
      };
      window.addEventListener("message", onReady);

      const existing = document.getElementById("ssp-maps-page-bridge");
      if (existing) {
        finish();
        return;
      }

      const script = document.createElement("script");
      script.id = "ssp-maps-page-bridge";
      script.src = chrome.runtime.getURL("maps-page-bridge.js");
      script.onerror = () => finish(new Error("Failed to inject Maps page bridge"));
      (document.head || document.documentElement).appendChild(script);

      const timer = window.setTimeout(() => {
        finish(new Error("Timed out waiting for Maps page bridge"));
      }, 5000);
    });

    return this.bridgeReady;
  }

  private callBridge(payload: Record<string, unknown>): Promise<BridgeResponse> {
    const id = `ssp-${++this.reqSeq}-${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Maps page bridge timed out"));
      }, 20000);

      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          window.clearTimeout(timer);
          reject(err);
        },
      });

      window.postMessage({ source: BRIDGE_REQUEST, id, ...payload }, "*");
    });
  }

  private emitLayout(): void {
    if (!this.layout) return;
    for (const l of this.layoutListeners) l({ ...this.layout });
  }

  private wireDrag(root: HTMLElement): void {
    const handle = root.querySelector("[data-drag-handle]");
    if (!(handle instanceof HTMLElement)) return;

    handle.addEventListener("pointerdown", (e) => {
      if (!this.layout) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      this.dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origX: this.layout.x,
        origY: this.layout.y,
      };
    });

    handle.addEventListener("pointermove", (e) => {
      if (!this.dragState || !this.layout || !this.root) return;
      const dx = e.clientX - this.dragState.startX;
      const dy = e.clientY - this.dragState.startY;
      this.layout = {
        ...this.layout,
        x: Math.max(0, this.dragState.origX + dx),
        y: Math.max(0, this.dragState.origY + dy),
      };
      applyLayout(this.root, this.layout);
    });

    handle.addEventListener("pointerup", () => {
      if (!this.dragState) return;
      this.dragState = null;
      this.emitLayout();
    });
  }

  private wireResize(root: HTMLElement): void {
    const handle = root.querySelector(".ssp-pano__resize");
    if (!(handle instanceof HTMLElement)) return;

    let resizing: {
      startX: number;
      startY: number;
      origW: number;
      origH: number;
    } | null = null;

    handle.addEventListener("pointerdown", (e) => {
      if (!this.layout) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      resizing = {
        startX: e.clientX,
        startY: e.clientY,
        origW: this.layout.width,
        origH: this.layout.height,
      };
    });

    handle.addEventListener("pointermove", (e) => {
      if (!resizing || !this.layout || !this.root) return;
      const dw = e.clientX - resizing.startX;
      const dh = e.clientY - resizing.startY;
      this.layout = {
        ...this.layout,
        width: Math.max(280, resizing.origW + dw),
        height: Math.max(200, resizing.origH + dh),
      };
      applyLayout(this.root, this.layout);
    });

    handle.addEventListener("pointerup", () => {
      if (!resizing) return;
      resizing = null;
      this.emitLayout();
    });
  }
}

function applyLayout(el: HTMLElement, layout: PanoLayout): void {
  el.style.left = `${layout.x}px`;
  el.style.top = `${layout.y}px`;
  el.style.width = `${layout.width}px`;
  el.style.height = `${layout.height}px`;
}
