import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: "12px",
          padding: "32px",
          color: "var(--text-secondary)",
        }}>
          <AlertTriangle size={24} />
          <p style={{ fontSize: "14px", fontWeight: 600 }}>Something went wrong</p>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: 400, textAlign: "center" }}>
            {this.state.error?.message}
          </p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            <RefreshCw size={14} />
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
