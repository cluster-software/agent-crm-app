import { ErrorCode, LoginState, createFrontendApisClient, type ApiErrorResponse } from "@propelauth/frontend-apis";
import { AuthProvider, saveOrgSelectionToLocalStorage, useAuthInfo } from "@propelauth/react";
import { Mail, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { api } from "./api";
import agentCrmWhiteLogo from "./assets/white-logo.png";
import type { AuthRuntimeConfig } from "../shared/types";

type AuthRoute = "sign-in" | "sign-up" | "confirm-email" | "create-workspace";

type ResolveOrgResponse = {
  ok?: boolean;
  org_id?: string;
  org_name?: string;
  code?: string;
  error?: string;
};

const AUTH_EMAIL_STORAGE_KEY = "agent-crm.auth.email";
const AUTH_RESOLVE_ORG_TIMEOUT_MS = 15_000;

export function DesktopAuth({
  appDisplayVersion,
  loading,
  error,
  onDismissError,
  onSignedIn
}: {
  appDisplayVersion: string;
  loading?: string;
  error?: string | null;
  onDismissError: () => void;
  onSignedIn: () => Promise<void>;
}) {
  const [config, setConfig] = useState<AuthRuntimeConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getAuthConfig()
      .then((nextConfig) => {
        if (!cancelled) setConfig(nextConfig);
      })
      .catch((err) => {
        if (!cancelled) setConfigError(statusFromError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const statusLoading = loading || (!config && !configError ? "Loading auth" : "");
  const statusError = error || configError;

  return (
    <div className="welcome-page" data-screen-label="Welcome">
      <div className="welcome-page__drag" aria-hidden="true" />
      <WelcomeStatus
        error={statusError}
        loading={statusLoading}
        onDismissError={error ? onDismissError : () => setConfigError(null)}
      />

      {config ? (
        <AuthProvider authUrl={config.authUrl}>
          <DesktopAuthFlow config={config} onSignedIn={onSignedIn} />
        </AuthProvider>
      ) : (
        <AuthShell>
          <StatusCallout
            title={configError ? "Could not load auth" : "Loading Agent CRM auth"}
            subtitle={configError ?? "Preparing sign in."}
          />
        </AuthShell>
      )}

      <footer className="welcome-footer mono">
        <span>agent-crm v{appDisplayVersion}</span>
        <span className="welcome-footer__ready">runtime ready</span>
      </footer>
    </div>
  );
}

function DesktopAuthFlow({
  config,
  onSignedIn
}: {
  config: AuthRuntimeConfig;
  onSignedIn: () => Promise<void>;
}) {
  const [route, setRoute] = useState<AuthRoute>("sign-in");
  const [loginState, setLoginState] = useState<LoginState | undefined>(LoginState.LOGIN_REQUIRED);
  const [loginStateError, setLoginStateError] = useState<string | undefined>();
  const [resolvingWorkspace, setResolvingWorkspace] = useState(false);
  const [resolveWorkspaceError, setResolveWorkspaceError] = useState<string | undefined>();
  const [personalDomainNeedsWorkspace, setPersonalDomainNeedsWorkspace] = useState(false);
  const resolvingWorkspaceRef = useRef(false);
  const authInfo = useAuthInfo();
  const refreshAuthInfo = authInfo.refreshAuthInfo;
  const getAuthAccessToken = authInfo.tokens.getAccessToken;
  const authApis = useMemo(
    () => createFrontendApisClient({ authUrl: config.authUrl, baseApiUrl: config.authUrl }),
    [config.authUrl]
  );

  const refreshLoginState = useCallback(async () => {
    setLoginStateError(undefined);
    const response = await authApis.fetchLoginState();
    if (response.ok) {
      setLoginState(response.data.login_state);
      if (shouldResolveWorkspaceForLoginState(response.data.login_state)) {
        await refreshAuthInfo();
      }
      return response.data.login_state;
    }
    setLoginStateError(errorMessage(response.error));
    return undefined;
  }, [authApis, refreshAuthInfo]);

  useEffect(() => {
    void refreshLoginState();
  }, [refreshLoginState]);

  useEffect(() => {
    if (route !== "confirm-email" || loginState !== LoginState.EMAIL_NOT_CONFIRMED_YET) return;
    const intervalId = window.setInterval(() => {
      void refreshLoginState();
    }, 2500);
    return () => window.clearInterval(intervalId);
  }, [loginState, refreshLoginState, route]);

  const getAccessToken = useCallback(async () => {
    if (authInfo.isLoggedIn) return authInfo.accessToken;
    return await getAuthAccessToken();
  }, [authInfo.accessToken, authInfo.isLoggedIn, getAuthAccessToken]);

  const finishResolvedWorkspace = useCallback(async (
    payload: ResolveOrgResponse,
    fallbackOrgId: string | undefined,
    token: string
  ) => {
    const orgId = payload.org_id ?? fallbackOrgId;
    if (!orgId) throw new Error("Workspace setup finished without an org id.");

    saveOrgSelectionToLocalStorage(orgId);
    await refreshAuthInfo();
    await api.completeDesktopAuth({
      accessToken: token,
      orgId,
      orgName: payload.org_name ?? null
    });
    await onSignedIn();
  }, [onSignedIn, refreshAuthInfo]);

  const requestWorkspaceResolution = useCallback(async (
    token: string,
    fallbackOrgId?: string
  ) => {
    const response = await fetchJsonWithTimeout(`${config.baseApiUrl}/auth/resolve-org`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`
      }
    }, AUTH_RESOLVE_ORG_TIMEOUT_MS);
    const payload = response.payload as ResolveOrgResponse | null;
    if (!response.ok || !payload?.ok || !(payload.org_id || fallbackOrgId)) {
      if (payload?.code === "personal_email_domain") {
        setPersonalDomainNeedsWorkspace(true);
        setRoute("create-workspace");
        return;
      }
      throw new Error(payload?.error || `Workspace setup failed with HTTP ${response.status}.`);
    }
    await finishResolvedWorkspace(payload, fallbackOrgId, token);
  }, [config.baseApiUrl, finishResolvedWorkspace]);

  const resolveWorkspace = useCallback(async () => {
    if (resolvingWorkspaceRef.current) return;
    resolvingWorkspaceRef.current = true;
    setResolvingWorkspace(true);
    setResolveWorkspaceError(undefined);
    setPersonalDomainNeedsWorkspace(false);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("PropelAuth has not issued an access token for this session yet.");
      await requestWorkspaceResolution(token);
    } catch (err) {
      setResolveWorkspaceError(statusFromError(err));
    } finally {
      resolvingWorkspaceRef.current = false;
      setResolvingWorkspace(false);
    }
  }, [getAccessToken, requestWorkspaceResolution]);

  const resolveOrglessWorkspace = useCallback(async () => {
    if (resolvingWorkspaceRef.current) return;
    resolvingWorkspaceRef.current = true;
    setResolvingWorkspace(true);
    setResolveWorkspaceError(undefined);
    setPersonalDomainNeedsWorkspace(false);
    try {
      const joinableResponse = await authApis.fetchJoinableOrgs();
      if (!joinableResponse.ok) throw new Error(errorMessage(joinableResponse.error));

      const joinableOrg = chooseJoinableOrg(joinableResponse.data.orgs);
      let orgId: string;
      if (joinableOrg) {
        const joinResponse = await authApis.joinOrg(joinableOrg.id);
        if (!joinResponse.ok) throw new Error(errorMessage(joinResponse.error));
        orgId = joinResponse.data.org_id;
      } else {
        const createResponse = await authApis.createOrg({
          name: orgNameFromEmail(storedEmail()),
          allow_users_to_join_by_domain: true,
          restrict_invites_by_domain: true
        });
        if (!createResponse.ok) {
          if (createResponse.error.error_code === ErrorCode.PersonalDomainError) {
            setPersonalDomainNeedsWorkspace(true);
            setRoute("create-workspace");
            return;
          }
          throw new Error(errorMessage(createResponse.error));
        }
        orgId = createResponse.data.org_id;
      }

      saveOrgSelectionToLocalStorage(orgId);
      const token = await waitForAccessTokenAfterOrgChange(getAuthAccessToken, refreshAuthInfo);
      if (!token) throw new Error("PropelAuth did not issue an access token after workspace selection.");
      await requestWorkspaceResolution(token, orgId);
    } catch (err) {
      setResolveWorkspaceError(statusFromError(err));
    } finally {
      resolvingWorkspaceRef.current = false;
      setResolvingWorkspace(false);
    }
  }, [authApis, getAuthAccessToken, refreshAuthInfo, requestWorkspaceResolution]);

  useEffect(() => {
    if (authInfo.loading || personalDomainNeedsWorkspace || resolveWorkspaceError) return;
    if (!shouldResolveWorkspaceForLoginState(loginState)) return;
    if (loginState === LoginState.USER_MUST_BE_IN_AT_LEAST_ONE_ORG && !authInfo.isLoggedIn) {
      void resolveOrglessWorkspace();
      return;
    }
    if (!authInfo.isLoggedIn) return;
    void resolveWorkspace();
  }, [
    authInfo.isLoggedIn,
    authInfo.loading,
    loginState,
    personalDomainNeedsWorkspace,
    resolveOrglessWorkspace,
    resolveWorkspace,
    resolveWorkspaceError
  ]);

  const retryWorkspaceResolution = useCallback(() => {
    setResolveWorkspaceError(undefined);
    if (loginState === LoginState.USER_MUST_BE_IN_AT_LEAST_ONE_ORG && !authInfo.isLoggedIn) {
      void resolveOrglessWorkspace();
      return;
    }
    if (authInfo.isLoggedIn) void resolveWorkspace();
  }, [authInfo.isLoggedIn, loginState, resolveOrglessWorkspace, resolveWorkspace]);

  if (!loginState && !loginStateError) {
    return (
      <AuthShell>
        <p className="auth-loading-copy">Loading Agent CRM auth...</p>
      </AuthShell>
    );
  }

  if (loginStateError && loginState !== LoginState.LOGIN_REQUIRED) {
    return (
      <AuthShell>
        <StatusCallout title="Could not load auth" subtitle={loginStateError} />
        <FootLine>
          <FootLink onClick={() => void refreshLoginState()}>Try again</FootLink>
        </FootLine>
      </AuthShell>
    );
  }

  if (isUnsupportedLoginState(loginState)) {
    return (
      <AuthShell>
        <StatusCallout
          title="One more step"
          subtitle="This account needs an additional hosted PropelAuth step before Agent CRM can continue."
        />
        <BigButton type="button" onClick={() => window.location.assign(config.authUrl)}>
          Continue
        </BigButton>
      </AuthShell>
    );
  }

  if (resolvingWorkspace) return <WorkspaceResolutionPage />;

  if (resolveWorkspaceError) {
    return <WorkspaceResolutionPage error={resolveWorkspaceError} onRetry={retryWorkspaceResolution} />;
  }

  if (route === "sign-up") {
    return (
      <SignUpPage
        authApis={authApis}
        authInfo={authInfo}
        config={config}
        navigate={setRoute}
        onLoginState={setLoginState}
        refreshLoginState={refreshLoginState}
      />
    );
  }

  if (route === "confirm-email") {
    return <ConfirmEmailPage authApis={authApis} navigate={setRoute} />;
  }

  if (route === "create-workspace") {
    return (
      <CreateWorkspacePage
        authApis={authApis}
        authInfo={authInfo}
        canCreateWorkspace={Boolean(authInfo.isLoggedIn || personalDomainNeedsWorkspace)}
        navigate={setRoute}
        resolveWorkspace={requestWorkspaceResolution}
      />
    );
  }

  return (
    <SignInPage
      authApis={authApis}
      authInfo={authInfo}
      config={config}
      navigate={setRoute}
      onLoginState={setLoginState}
      refreshLoginState={refreshLoginState}
    />
  );
}

function SignInPage({
  authApis,
  authInfo,
  config,
  navigate,
  refreshLoginState,
  onLoginState
}: {
  authApis: ReturnType<typeof createFrontendApisClient>;
  authInfo: ReturnType<typeof useAuthInfo>;
  config: AuthRuntimeConfig;
  navigate: (route: AuthRoute) => void;
  refreshLoginState: () => Promise<LoginState | undefined>;
  onLoginState: (state: LoginState) => void;
}) {
  const [email, setEmail] = useState(storedEmail());
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [openingGoogle, setOpeningGoogle] = useState(false);

  async function startGoogleAuth() {
    setOpeningGoogle(true);
    setError(undefined);
    try {
      await api.startExternalAuth({ route: "sign-in", provider: "google" });
    } catch (err) {
      setError(statusFromError(err));
    } finally {
      setOpeningGoogle(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    safeSetSessionStorage(AUTH_EMAIL_STORAGE_KEY, email);
    try {
      const response = await authApis.emailPasswordLogin({ email, password });
      if (!response.ok) {
        setError(errorMessage(response.error));
        return;
      }
      onLoginState(response.data.login_state);
      if (response.data.login_state === LoginState.EMAIL_NOT_CONFIRMED_YET) {
        navigate("confirm-email");
      } else if (shouldResolveWorkspaceForLoginState(response.data.login_state)) {
        await authInfo.refreshAuthInfo();
        await refreshLoginState();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthHero title="Sign in" subtitle="Welcome back." />
      <form className="auth-form-stack" onSubmit={submit}>
        <BigButton type="button" variant="quiet" icon={<IconGoogle size={18} />} onClick={() => void startGoogleAuth()} disabled={openingGoogle || submitting}>
          {openingGoogle ? "Opening browser..." : "Sign in with Google"}
        </BigButton>
        <AuthDivider />
        <Field label="Email" type="email" placeholder="you@company.com" mono value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
        <Field
          label="Password"
          type="password"
          placeholder="at least 12 characters"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          trailing={<a className="auth-subtle-link" href={config.forgotPasswordUrl}>Forgot password?</a>}
          required
        />
        <FormError message={error} />
        <BigButton type="submit" disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</BigButton>
      </form>
      <FootLine>
        Don't have an account? <FootLink onClick={() => navigate("sign-up")}>Sign up</FootLink>
      </FootLine>
    </AuthShell>
  );
}

function SignUpPage({
  authApis,
  authInfo,
  config,
  navigate,
  refreshLoginState,
  onLoginState
}: {
  authApis: ReturnType<typeof createFrontendApisClient>;
  authInfo: ReturnType<typeof useAuthInfo>;
  config: AuthRuntimeConfig;
  navigate: (route: AuthRoute) => void;
  refreshLoginState: () => Promise<LoginState | undefined>;
  onLoginState: (state: LoginState) => void;
}) {
  const [email, setEmail] = useState(storedEmail());
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [openingGoogle, setOpeningGoogle] = useState(false);

  async function startGoogleAuth() {
    setOpeningGoogle(true);
    setError(undefined);
    try {
      await api.startExternalAuth({ route: "sign-up", provider: "google" });
    } catch (err) {
      setError(statusFromError(err));
    } finally {
      setOpeningGoogle(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    safeSetSessionStorage(AUTH_EMAIL_STORAGE_KEY, email);
    try {
      const response = await authApis.signup({ email, password });
      if (!response.ok) {
        setError(errorMessage(response.error));
        return;
      }
      onLoginState(response.data.login_state);
      if (shouldShowConfirmEmailAfterSignup(response.data.login_state)) {
        navigate("confirm-email");
      } else if (shouldResolveWorkspaceForLoginState(response.data.login_state)) {
        await authInfo.refreshAuthInfo();
        await refreshLoginState();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthHero title="Sign up" subtitle="Use your work email to create your Agent CRM account." />
      <form className="auth-form-stack" onSubmit={submit}>
        <BigButton type="button" variant="quiet" icon={<IconGoogle size={18} />} onClick={() => void startGoogleAuth()} disabled={openingGoogle || submitting}>
          {openingGoogle ? "Opening browser..." : "Sign up with Google"}
        </BigButton>
        <AuthDivider />
        <Field label="Work email" type="email" placeholder="you@company.com" mono value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
        <Field
          label="Password"
          type="password"
          placeholder="at least 12 characters"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
        <FormError message={error} />
        <BigButton type="submit" disabled={submitting}>
          {submitting ? "Creating account..." : "Create account"}
        </BigButton>
      </form>
      <FootLine>
        Already have an account? <FootLink onClick={() => navigate("sign-in")}>Sign in</FootLink>
      </FootLine>
    </AuthShell>
  );
}

function ConfirmEmailPage({
  authApis,
  navigate
}: {
  authApis: ReturnType<typeof createFrontendApisClient>;
  navigate: (route: AuthRoute) => void;
}) {
  const email = storedEmail() || "your email";
  const [message, setMessage] = useState("Resend confirmation email");
  const [submitting, setSubmitting] = useState(false);

  async function resend() {
    setSubmitting(true);
    const response = await authApis.resendEmailConfirmation();
    if (response.ok) {
      setMessage("Confirmation email sent");
    } else {
      setMessage(errorMessage(response.error));
    }
    setSubmitting(false);
  }

  return (
    <AuthShell>
      <StatusCallout
        icon={<Mail size={22} />}
        title="Check your email"
        subtitle="We sent a confirmation link to the address below. Click it to finish signing up."
      />
      <div className="auth-email-callout">
        <Mail size={14} color="var(--text-dim)" />
        <span className="auth-email-callout-address">{email}</span>
        <FootLink onClick={() => navigate("sign-up")}>change</FootLink>
      </div>
      <ul className="auth-helper-list">
        <li><span className="auth-dot" /><span>Link expires in <span className="auth-mono-text">10 min</span>. You can request a new one any time.</span></li>
        <li><span className="auth-dot" /><span>Check spam if it has not arrived in a minute.</span></li>
      </ul>
      <div className="auth-form-stack auth-resend-stack">
        <BigButton type="button" variant="quiet" disabled={submitting} onClick={resend}>
          {submitting ? "Sending..." : message}
        </BigButton>
      </div>
      <FootLine>
        Wrong email? <FootLink onClick={() => navigate("sign-up")}>Use a different one</FootLink>
      </FootLine>
    </AuthShell>
  );
}

function CreateWorkspacePage({
  authApis,
  authInfo,
  canCreateWorkspace,
  navigate,
  resolveWorkspace
}: {
  authApis: ReturnType<typeof createFrontendApisClient>;
  authInfo: ReturnType<typeof useAuthInfo>;
  canCreateWorkspace: boolean;
  navigate: (route: AuthRoute) => void;
  resolveWorkspace: (token: string, fallbackOrgId?: string) => Promise<void>;
}) {
  const email = authInfo.isLoggedIn ? authInfo.user.email : storedEmail();
  const [name, setName] = useState(defaultWorkspaceName(email));
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || created) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await authApis.createOrg({
        name,
        allow_users_to_join_by_domain: false,
        restrict_invites_by_domain: false
      });
      if (!response.ok) {
        setError(errorMessage(response.error));
        return;
      }
      setCreated(true);
      saveOrgSelectionToLocalStorage(response.data.org_id);
      const token = await waitForAccessTokenAfterOrgChange(authInfo.tokens.getAccessToken, authInfo.refreshAuthInfo);
      if (!token) throw new Error("PropelAuth did not issue an access token after workspace creation.");
      await resolveWorkspace(token, response.data.org_id);
    } catch (err) {
      setError(statusFromError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!canCreateWorkspace) {
    return (
      <AuthShell>
        <StatusCallout
          title="Create workspace"
          subtitle="Sign in before creating your Agent CRM workspace."
        />
        <BigButton type="button" onClick={() => navigate("sign-in")}>Sign in</BigButton>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHero title="Create workspace" subtitle="Name the workspace Agent CRM should use for this email address." />
      <form className="auth-form-stack" onSubmit={submit}>
        <Field label="Workspace name" value={name} onChange={(event) => setName(event.currentTarget.value)} required disabled={submitting || created} />
        <FormError message={error} />
        <BigButton type="submit" disabled={submitting || created}>
          {created ? "Workspace created" : submitting ? "Creating..." : "Create workspace"}
        </BigButton>
      </form>
    </AuthShell>
  );
}

function WorkspaceResolutionPage({
  error,
  onRetry
}: {
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <AuthShell>
      <StatusCallout
        title={error ? "Could not continue" : "Opening Agent CRM"}
        subtitle={error ?? "Preparing your account."}
      />
      {error && onRetry ? (
        <BigButton type="button" variant="quiet" onClick={onRetry}>Try again</BigButton>
      ) : null}
    </AuthShell>
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-column">
        <div className="auth-brand">
          <img src={agentCrmWhiteLogo} alt="Agent CRM" draggable="false" />
        </div>
        {children}
      </section>
    </main>
  );
}

function AuthHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="auth-hero">
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}

function AuthDivider({ children = "OR" }: { children?: ReactNode }) {
  return (
    <div className="auth-divider" aria-hidden="true">
      <span>{children}</span>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  trailing?: ReactNode;
  mono?: boolean;
  error?: string;
};

function Field({ label, hint, trailing, mono, error, ...inputProps }: FieldProps) {
  return (
    <label className="auth-field">
      <span className="auth-field-label-row">
        <span>{label}</span>
        {trailing ? <span className="auth-field-trailing">{trailing}</span> : null}
      </span>
      <input className={mono ? "mono" : undefined} {...inputProps} />
      {error ? <span className="auth-field-error">{error}</span> : hint ? <span className="auth-field-hint">{hint}</span> : null}
    </label>
  );
}

function BigButton({
  variant = "primary",
  icon,
  iconRight,
  children,
  className,
  ...buttonProps
}: {
  variant?: "primary" | "quiet";
  icon?: ReactNode;
  iconRight?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={["auth-big-button", `auth-big-button--${variant}`, className].filter(Boolean).join(" ")} {...buttonProps}>
      {icon}
      <span>{children}</span>
      {iconRight}
    </button>
  );
}

function FootLine({ children }: { children: ReactNode }) {
  return <div className="auth-foot-line">{children}</div>;
}

function FootLink({
  children,
  onClick,
  href
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  return (
    <a
      href={href ?? "#"}
      className="auth-foot-link"
      onClick={(event) => {
        if (!href) event.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  );
}

function StatusCallout({
  icon,
  title,
  subtitle,
  kind = "neutral"
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  kind?: "neutral" | "success";
}) {
  return (
    <div className={`auth-status-callout auth-status-callout--${kind}`}>
      {icon ? <div className="auth-status-icon">{icon}</div> : null}
      <AuthHero title={title} subtitle={subtitle} />
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  return message ? <div className="auth-form-error" role="alert">{message}</div> : null;
}

function WelcomeStatus({
  error,
  loading,
  onDismissError
}: {
  error?: string | null;
  loading?: string;
  onDismissError: () => void;
}) {
  if (!error && !loading) return null;
  return (
    <div className="welcome-page__status">
      {error ? (
        <div className="strip strip--error">
          <span>{error}</span>
          <button className="strip__close" type="button" onClick={onDismissError}>
            <X size={14} className="lucide" />
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="strip strip--loading">
          <span>{loading}</span>
        </div>
      ) : null}
    </div>
  );
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    return {
      ok: response.ok,
      status: response.status,
      payload: await response.json().catch(() => null)
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Workspace setup timed out before Agent CRM received a response.");
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function waitForAccessTokenAfterOrgChange(
  getAccessToken: () => Promise<string | undefined>,
  refreshAuthInfo: () => Promise<void>
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await refreshAuthInfo();
    const token = await getAccessToken();
    if (token) return token;
    await delay(500);
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldShowConfirmEmailAfterSignup(loginState: LoginState): boolean {
  return loginState === LoginState.LOGIN_REQUIRED ||
    loginState === LoginState.EMAIL_NOT_CONFIRMED_YET;
}

function shouldResolveWorkspaceForLoginState(loginState: LoginState | undefined): boolean {
  return loginState === LoginState.LOGGED_IN ||
    loginState === LoginState.USER_MUST_BE_IN_AT_LEAST_ONE_ORG;
}

function isUnsupportedLoginState(state: LoginState | undefined): boolean {
  return Boolean(state && ![
    LoginState.LOGIN_REQUIRED,
    LoginState.EMAIL_NOT_CONFIRMED_YET,
    LoginState.USER_MUST_BE_IN_AT_LEAST_ONE_ORG,
    LoginState.LOGGED_IN
  ].includes(state));
}

function chooseJoinableOrg<Org extends { id: string; name: string }>(orgs: Org[]): Org | undefined {
  return orgs
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))[0];
}

function orgNameFromEmail(email: string | undefined): string {
  const rawDomain = email?.trim().toLowerCase().split("@")[1];
  const label = rawDomain?.split(".")[0]?.replace(/[._-]+/g, " ").trim();
  if (!label) return "My workspace";
  return label
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function defaultWorkspaceName(email: string | undefined): string {
  const trimmed = email?.trim();
  if (!trimmed) return "My workspace";
  const name = trimmed.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!name || name.toLowerCase() === "you") return "My workspace";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}'s workspace`;
}

function storedEmail(): string {
  return safeGetSessionStorage(AUTH_EMAIL_STORAGE_KEY) ?? "";
}

function safeGetSessionStorage(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function safeSetSessionStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage access can fail in restricted renderer contexts.
  }
}

function errorMessage(error: ApiErrorResponse): string {
  const fieldMessage = error.field_errors ? firstErrorMessage(Object.values(error.field_errors)[0]) : undefined;
  const userFieldMessage = error.user_facing_errors ? firstErrorMessage(Object.values(error.user_facing_errors)[0]) : undefined;
  return fieldMessage ?? userFieldMessage ?? error.user_facing_error ?? "The request could not be completed.";
}

function firstErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string");
  return undefined;
}

function statusFromError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}


function IconGoogle({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.638-.057-1.253-.164-1.842H9v3.482h4.844c-.209 1.125-.843 2.079-1.796 2.718v2.258h2.908c1.702-1.567 2.684-3.873 2.684-6.616Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.179l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.331C2.438 15.983 5.482 18 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.712A5.41 5.41 0 0 1 3.682 9c0-.594.102-1.172.282-1.712V4.957H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.043l3.007-2.331Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.579c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.891 11.425 0 9 0 5.482 0 2.438 2.017.957 4.957l3.007 2.331C4.672 5.162 6.656 3.579 9 3.579Z"
      />
    </svg>
  );
}
