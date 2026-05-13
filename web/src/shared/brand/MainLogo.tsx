import { OocLogo } from "./OocLogo";

export function MainLogo() {
  return (
    <div className="logo-row">
      <OocLogo />
      <div style={{ flex: 1 }}>
        <div className="logo-title">OOC</div>
        <div className="logo-subtitle">Web Control Plane</div>
      </div>
      <span className="pill">web</span>
    </div>
  );
}

