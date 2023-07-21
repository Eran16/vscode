/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
 use crate::{
	constants::{APPLICATION_NAME, CONTROL_PORT, DOCUMENTATION_URL, QUALITYLESS_PRODUCT_NAME},
	rpc::ResponseError,
};
use std::fmt::Display;
use thiserror::Error;

// Wraps another error with additional info.
#[derive(Debug, Clone)]
pub struct WrappedError {
	message: String,
	original: String,
}

impl std::fmt::Display for WrappedError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}: {}", self.message, self.original)
	}
}

impl std::error::Error for WrappedError {
	fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
		None
	}
}

impl WrappedError {
	// fn new(original: Box<dyn std::error::Error>, message: String) -> WrappedError {
	//     WrappedError { message, original }
	// }
}

impl From<reqwest::Error> for WrappedError {
	fn from(e: reqwest::Error) -> WrappedError {
		WrappedError {
			message: format!(
				"error requesting {}",
				e.url().map_or("<unknown>", |u| u.as_str())
			),
			original: format!("{}", e),
		}
	}
}

pub fn wrapdbg<T, S>(original: T, message: S) -> WrappedError
where
	T: std::fmt::Debug,
	S: Into<String>,
{
	WrappedError {
		message: message.into(),
		original: format!("{:?}", original),
	}
}

pub fn wrap<T, S>(original: T, message: S) -> WrappedError
where
	T: Display,
	S: Into<String>,
{
	WrappedError {
		message: message.into(),
		original: format!("{}", original),
	}
}

// Error generated by an unsuccessful HTTP response
#[derive(Debug)]
pub struct StatusError {
	pub url: String,
	pub status_code: u16,
	pub body: String,
}

impl std::fmt::Display for StatusError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"error requesting {}: {} {}",
			self.url, self.status_code, self.body
		)
	}
}

impl StatusError {
	pub async fn from_res(res: reqwest::Response) -> Result<StatusError, AnyError> {
		let status_code = res.status().as_u16();
		let url = res.url().to_string();
		let body = res.text().await.map_err(|e| {
			wrap(
				e,
				format!(
					"failed to read response body on {} code from {}",
					status_code, url
				),
			)
		})?;

		Ok(StatusError {
			url,
			status_code,
			body,
		})
	}
}

// When the user has not consented to the licensing terms in using the Launcher
#[derive(Debug)]
pub struct MissingLegalConsent(pub String);

impl std::fmt::Display for MissingLegalConsent {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", self.0)
	}
}

// When the provided connection token doesn't match the one used to set up the original VS Code Server
// This is most likely due to a new user joining.
#[derive(Debug)]
pub struct MismatchConnectionToken(pub String);

impl std::fmt::Display for MismatchConnectionToken {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", self.0)
	}
}

// When the VS Code server has an unrecognized extension (rather than zip or gz)
#[derive(Debug)]
pub struct InvalidServerExtensionError(pub String);

impl std::fmt::Display for InvalidServerExtensionError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "invalid server extension '{}'", self.0)
	}
}

// When the tunnel fails to open
#[derive(Debug, Clone)]
pub struct DevTunnelError(pub String);

impl std::fmt::Display for DevTunnelError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "could not open tunnel: {}", self.0)
	}
}

impl std::error::Error for DevTunnelError {
	fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
		None
	}
}

// When the server was downloaded, but the entrypoint scripts don't exist.
#[derive(Debug)]
pub struct MissingEntrypointError();

impl std::fmt::Display for MissingEntrypointError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Missing entrypoints in server download. Most likely this is a corrupted download. Please retry")
	}
}

#[derive(Debug)]
pub struct SetupError(pub String);

impl std::fmt::Display for SetupError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"{}\n\nMore info at {}/remote/linux",
			DOCUMENTATION_URL.unwrap_or("<docs>"),
			self.0
		)
	}
}

#[derive(Debug)]
pub struct NoHomeForLauncherError();

impl std::fmt::Display for NoHomeForLauncherError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
            f,
            "No $HOME variable was found in your environment. Either set it, or specify a `--data-dir` manually when invoking the launcher.",
        )
	}
}

#[derive(Debug)]
pub struct InvalidTunnelName(pub String);

impl std::fmt::Display for InvalidTunnelName {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", &self.0)
	}
}

#[derive(Debug)]
pub struct TunnelCreationFailed(pub String, pub String);

impl std::fmt::Display for TunnelCreationFailed {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"Could not create tunnel with name: {}\nReason: {}",
			&self.0, &self.1
		)
	}
}

#[derive(Debug)]
pub struct TunnelHostFailed(pub String);

impl std::fmt::Display for TunnelHostFailed {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", &self.0)
	}
}

#[derive(Debug)]
pub struct ExtensionInstallFailed(pub String);

impl std::fmt::Display for ExtensionInstallFailed {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Extension install failed: {}", &self.0)
	}
}

#[derive(Debug)]
pub struct MismatchedLaunchModeError();

impl std::fmt::Display for MismatchedLaunchModeError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "A server is already running, but it was not launched in the same listening mode (port vs. socket) as this request")
	}
}

#[derive(Debug)]
pub struct NoAttachedServerError();

impl std::fmt::Display for NoAttachedServerError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "No server is running")
	}
}

#[derive(Debug)]
pub struct RefreshTokenNotAvailableError();

impl std::fmt::Display for RefreshTokenNotAvailableError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Refresh token not available, authentication is required")
	}
}

#[derive(Debug)]
pub struct NoInstallInUserProvidedPath(pub String);

impl std::fmt::Display for NoInstallInUserProvidedPath {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
            f,
            "No {} installation could be found in {}. You can run `{} --use-quality=stable` to switch to the latest stable version of {}.",
						QUALITYLESS_PRODUCT_NAME,
            self.0,
						APPLICATION_NAME,
						QUALITYLESS_PRODUCT_NAME
        )
	}
}

#[derive(Debug)]
pub struct InvalidRequestedVersion();

impl std::fmt::Display for InvalidRequestedVersion {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
            f,
            "The reqested version is invalid, expected one of 'stable', 'insiders', version number (x.y.z), or absolute path.",
        )
	}
}

#[derive(Debug)]
pub struct UserCancelledInstallation();

impl std::fmt::Display for UserCancelledInstallation {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Installation aborted.")
	}
}

#[derive(Debug)]
pub struct CannotForwardControlPort();

impl std::fmt::Display for CannotForwardControlPort {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Cannot forward or unforward port {}.", CONTROL_PORT)
	}
}

#[derive(Debug)]
pub struct ServerHasClosed();

impl std::fmt::Display for ServerHasClosed {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Request cancelled because the server has closed")
	}
}

#[derive(Debug)]
pub struct UpdatesNotConfigured(pub String);

impl UpdatesNotConfigured {
	pub fn no_url() -> Self {
		UpdatesNotConfigured("no service url".to_owned())
	}
}

impl std::fmt::Display for UpdatesNotConfigured {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Update service is not configured: {}", self.0)
	}
}
#[derive(Debug)]
pub struct ServiceAlreadyRegistered();

impl std::fmt::Display for ServiceAlreadyRegistered {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Already registered the service. Run `{} tunnel service uninstall` to unregister it first", APPLICATION_NAME)
	}
}

#[derive(Debug)]
pub struct WindowsNeedsElevation(pub String);

impl std::fmt::Display for WindowsNeedsElevation {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		writeln!(f, "{}", self.0)?;
		writeln!(f)?;
		writeln!(f, "You may need to run this command as an administrator:")?;
		writeln!(f, " 1. Open the start menu and search for Powershell")?;
		writeln!(f, " 2. Right click and 'Run as administrator'")?;
		if let Ok(exe) = std::env::current_exe() {
			writeln!(
				f,
				" 3. Run &'{}' '{}'",
				exe.display(),
				std::env::args().skip(1).collect::<Vec<_>>().join("' '")
			)
		} else {
			writeln!(f, " 3. Run the same command again",)
		}
	}
}

#[derive(Debug)]
pub struct InvalidRpcDataError(pub String);

impl std::fmt::Display for InvalidRpcDataError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "parse error: {}", self.0)
	}
}

#[derive(Debug)]
pub struct CorruptDownload(pub String);

impl std::fmt::Display for CorruptDownload {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"Error updating the {} CLI: {}",
			QUALITYLESS_PRODUCT_NAME, self.0
		)
	}
}

#[derive(Debug)]
pub struct MissingHomeDirectory();

impl std::fmt::Display for MissingHomeDirectory {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Could not find your home directory. Please ensure this command is running in the context of an normal user.")
	}
}

#[derive(Debug)]
pub struct OAuthError {
	pub error: String,
	pub error_description: Option<String>,
}

impl std::fmt::Display for OAuthError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"Error getting authorization: {} {}",
			self.error,
			self.error_description.as_deref().unwrap_or("")
		)
	}
}

// Makes an "AnyError" enum that contains any of the given errors, in the form
// `enum AnyError { FooError(FooError) }` (when given `makeAnyError!(FooError)`).
// Useful to easily deal with application error types without making tons of "From"
// clauses.
macro_rules! makeAnyError {
    ($($e:ident),*) => {

        #[derive(Debug)]
        #[allow(clippy::enum_variant_names)]
        pub enum AnyError {
            $($e($e),)*
        }

        impl std::fmt::Display for AnyError {
            fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                match *self {
                    $(AnyError::$e(ref e) => e.fmt(f),)*
                }
            }
        }

        impl std::error::Error for AnyError {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                None
            }
        }

        $(impl From<$e> for AnyError {
            fn from(e: $e) -> AnyError {
                AnyError::$e(e)
            }
        })*
    };
}

#[derive(Debug)]
pub struct DbusConnectFailedError(pub String);

impl Display for DbusConnectFailedError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		let mut str = String::new();
		str.push_str("Error creating dbus session. This command uses systemd for managing services, you should check that systemd is installed and under your user.");

		if std::env::var("WSL_DISTRO_NAME").is_ok() {
			str.push_str("\n\nTo enable systemd on WSL, check out: https://devblogs.microsoft.com/commandline/systemd-support-is-now-available-in-wsl/.\n\n");
		}

		str.push_str("If running `systemctl status` works, systemd is ok, but your session dbus may not be. You might need to:\n\n- Install the `dbus-user-session` package, and reboot if it was not installed\n- Start the user dbus session with `systemctl --user enable dbus --now`.\n\nThe error encountered was: ");
		str.push_str(&self.0);
		str.push('\n');

		write!(f, "{}", str)
	}
}

/// Internal errors in the VS Code CLI.
/// Note: other error should be migrated to this type gradually
#[derive(Error, Debug)]
pub enum CodeError {
	#[error("could not connect to socket/pipe: {0:?}")]
	AsyncPipeFailed(std::io::Error),
	#[error("could not listen on socket/pipe: {0:?}")]
	AsyncPipeListenerFailed(std::io::Error),
	#[error("could not create singleton lock file: {0:?}")]
	SingletonLockfileOpenFailed(std::io::Error),
	#[error("could not read singleton lock file: {0:?}")]
	SingletonLockfileReadFailed(rmp_serde::decode::Error),
	#[error("the process holding the singleton lock file (pid={0}) exited")]
	SingletonLockedProcessExited(u32),
	#[error("no tunnel process is currently running")]
	NoRunningTunnel,
	#[error("rpc call failed: {0:?}")]
	TunnelRpcCallFailed(ResponseError),
	#[cfg(windows)]
	#[error("the windows app lock {0} already exists")]
	AppAlreadyLocked(String),
	#[cfg(windows)]
	#[error("could not get windows app lock: {0:?}")]
	AppLockFailed(std::io::Error),
	#[error("failed to run command \"{command}\" (code {code}): {output}")]
	CommandFailed {
		command: String,
		code: i32,
		output: String,
	},

	#[error("platform not currently supported: {0}")]
	UnsupportedPlatform(String),
	#[error("This machine not meet {name}'s prerequisites, expected either...: {bullets}")]
	PrerequisitesFailed { name: &'static str, bullets: String },
	#[error("failed to spawn process: {0:?}")]
	ProcessSpawnFailed(std::io::Error),
	#[error("failed to handshake spawned process: {0:?}")]
	ProcessSpawnHandshakeFailed(std::io::Error),
	#[error("download appears corrupted, please retry ({0})")]
	CorruptDownload(&'static str),
	#[error("port forwarding is not available in this context")]
	PortForwardingNotAvailable,
	#[error("'auth' call required")]
	ServerAuthRequired,
	#[error("challenge not yet issued")]
	AuthChallengeNotIssued,
	#[error("challenge token is invalid")]
	AuthChallengeBadToken,
	#[error("unauthorized client refused")]
	AuthMismatch,
	#[error("keyring communication timed out after 5s")]
	KeyringTimeout,
}

makeAnyError!(
	MissingLegalConsent,
	MismatchConnectionToken,
	DevTunnelError,
	StatusError,
	WrappedError,
	InvalidServerExtensionError,
	MissingEntrypointError,
	SetupError,
	NoHomeForLauncherError,
	TunnelCreationFailed,
	TunnelHostFailed,
	InvalidTunnelName,
	ExtensionInstallFailed,
	MismatchedLaunchModeError,
	NoAttachedServerError,
	RefreshTokenNotAvailableError,
	NoInstallInUserProvidedPath,
	UserCancelledInstallation,
	InvalidRequestedVersion,
	CannotForwardControlPort,
	ServerHasClosed,
	ServiceAlreadyRegistered,
	WindowsNeedsElevation,
	UpdatesNotConfigured,
	CorruptDownload,
	MissingHomeDirectory,
	OAuthError,
	InvalidRpcDataError,
	CodeError,
	DbusConnectFailedError
);

impl From<reqwest::Error> for AnyError {
	fn from(e: reqwest::Error) -> AnyError {
		AnyError::WrappedError(WrappedError::from(e))
	}
}
