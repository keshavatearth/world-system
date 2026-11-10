import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err)
      return React.createElement("pre", { style: { padding: 20, color: "#b00", whiteSpace: "pre-wrap", fontSize: 13 } },
        String(this.state.err?.stack || this.state.err));
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  React.createElement(Boundary, null, React.createElement(App))
);
