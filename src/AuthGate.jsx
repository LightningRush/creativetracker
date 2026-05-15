import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";

const clerkAppearance = {
  variables: {
    colorBackground: "#0C0C10",
    colorInputBackground: "#14141A",
    colorInputText: "#F0F0F6",
    colorText: "#F0F0F6",
    colorTextSecondary: "#9494B0",
    colorPrimary: "#8B7FFF",
    colorDanger: "#F87171",
    borderRadius: "10px",
  },
  elements: {
    rootBox: { width: "100%", maxWidth: 420 },
    card: {
      background: "#14141A",
      border: "1px solid #2A2A36",
      boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
    },
    headerTitle: { color: "#F0F0F6" },
    headerSubtitle: { color: "#9494B0" },
    socialButtonsBlockButton: {
      background: "#1C1C24",
      border: "1px solid #2A2A36",
      color: "#F0F0F6",
    },
    formFieldInput: {
      background: "#1C1C24",
      border: "1px solid #2A2A36",
    },
    footerActionLink: { color: "#8B7FFF" },
  },
};

export function MissingAuthConfig() {
  return (
    <Wrapper style={shell}>
      <Icon style={mark}>◈</Icon>
      <h1 style={title}>Sign-in not configured</h1>
      <p style={copy}>
        Add <code style={code}>VITE_CLERK_PUBLISHABLE_KEY</code> in Vercel → Project →
        Settings → Environment Variables, then redeploy.
      </p>
      <p style={copy}>
        Create a free app at{" "}
        <a href="https://dashboard.clerk.com" style={link}>
          dashboard.clerk.com
        </a>
        , then restrict sign-ups to your team only.
      </p>
    </Wrapper>
  );
}

export default function AuthGate({ children }) {
  return (
    <>
      <SignedOut>
        <Wrapper style={shell}>
          <Wrapper style={{ textAlign: "center", marginBottom: 28 }}>
            <Icon style={mark}>◈</Icon>
            <h1 style={title}>Studio Tracker</h1>
            <p style={copy}>Sign in with your team account to continue.</p>
          </Wrapper>
          <SignIn routing="hash" appearance={clerkAppearance} />
        </Wrapper>
      </SignedOut>
      <SignedIn>{children}</SignedIn>
    </>
  );
}

function Wrapper({ style, children }) {
  return <div style={style}>{children}</div>;
}

function Icon({ style, children }) {
  return <div style={style}>{children}</div>;
}

const shell = {
  minHeight: "100vh",
  background: "#0C0C10",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const mark = {
  width: 44,
  height: 44,
  margin: "0 auto 12px",
  background: "linear-gradient(135deg, #8B7FFF, #6055CC)",
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 20,
  color: "#fff",
};

const title = { margin: 0, fontSize: 22, fontWeight: 700, color: "#F0F0F6" };
const copy = { margin: "8px 0 0", fontSize: 14, color: "#9494B0", lineHeight: 1.5, maxWidth: 420, textAlign: "center" };
const code = { background: "#1C1C24", padding: "2px 6px", borderRadius: 4, color: "#8B7FFF" };
const link = { color: "#8B7FFF" };
