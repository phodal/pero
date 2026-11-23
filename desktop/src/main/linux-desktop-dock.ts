import { BrowserWindow, View, WebContentsView } from 'electron';

/** Lay out both renderers in content coordinates so the chat can still receive input. */
export class LinuxDesktopDock {
  private readonly workbench: View;
  private readonly split = new View();
  private left = false;
  private readonly layout = () => {
    const [width, height] = this.window.getContentSize();
    const panel = Math.round(width * 0.45);
    this.workbench.setBounds({ x: this.left ? panel : 0, y: 0, width: width - panel, height });
    this.viewer.setBounds({ x: this.left ? 0 : width - panel, y: 0, width: panel, height });
  };
  constructor(readonly window: BrowserWindow, readonly viewer: WebContentsView) {
    this.workbench = window.contentView;
    window.setContentView(this.split);
    this.split.addChildView(this.workbench);
    this.split.addChildView(viewer);
    window.on('resize', this.layout);
    this.layout();
  }
  get side() { return this.left ? 'left' as const : 'right' as const; }
  move() { this.left = !this.left; this.layout(); }
  close() {
    this.window.removeListener('resize', this.layout);
    if (!this.window.isDestroyed()) {
      this.split.removeChildView(this.viewer);
      this.split.removeChildView(this.workbench);
      this.window.setContentView(this.workbench);
      const [width, height] = this.window.getContentSize();
      this.workbench.setBounds({ x: 0, y: 0, width, height });
    }
    if (!this.viewer.webContents.isDestroyed()) this.viewer.webContents.close();
  }
}
