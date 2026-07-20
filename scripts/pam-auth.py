#!/usr/bin/env python3
"""Authenticate username/password via PAM (libpam ctypes).

Password is read from stdin (may include a trailing newline).
Prints OK on success; exits non-zero on failure.

PAM frees conversation responses with free(), so we must allocate them
with libc malloc/strdup — not Python ctypes-managed buffers.
"""
from __future__ import annotations

import ctypes
import sys

PAM_SUCCESS = 0
PAM_PROMPT_ECHO_OFF = 1
PAM_PROMPT_ECHO_ON = 2
PAM_ERROR_MSG = 3
PAM_TEXT_INFO = 4


class PamHandle(ctypes.Structure):
    _fields_ = [("handle", ctypes.c_void_p)]


class PamMessage(ctypes.Structure):
    _fields_ = [("msg_style", ctypes.c_int), ("msg", ctypes.c_char_p)]


class PamResponse(ctypes.Structure):
    _fields_ = [("resp", ctypes.c_char_p), ("resp_retcode", ctypes.c_int)]


CONV_FUNC = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_int,
    ctypes.POINTER(ctypes.POINTER(PamMessage)),
    ctypes.POINTER(ctypes.POINTER(PamResponse)),
    ctypes.c_void_p,
)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: pam-auth.py <username>", file=sys.stderr)
        return 2
    username = sys.argv[1].encode("utf-8")
    password = sys.stdin.buffer.read()
    if not password:
        print("empty password", file=sys.stderr)
        return 1
    # Strip a single trailing newline from the pipe, keep password otherwise intact
    if password.endswith(b"\n"):
        password = password[:-1]
    if password.endswith(b"\r"):
        password = password[:-1]

    libpam = ctypes.CDLL("libpam.so.0")
    libc = ctypes.CDLL("libc.so.6")
    libc.malloc.restype = ctypes.c_void_p
    libc.malloc.argtypes = [ctypes.c_size_t]
    libc.calloc.restype = ctypes.c_void_p
    libc.calloc.argtypes = [ctypes.c_size_t, ctypes.c_size_t]
    libc.strdup.restype = ctypes.c_void_p
    libc.strdup.argtypes = [ctypes.c_char_p]
    libc.free.argtypes = [ctypes.c_void_p]

    @CONV_FUNC
    def conv(n_msg, msg, resp, _app_data):
        if n_msg <= 0 or not resp:
            return 1
        # Array of pam_response that PAM will free()
        addr = libc.calloc(n_msg, ctypes.sizeof(PamResponse))
        if not addr:
            return 1
        resp[0] = ctypes.cast(addr, ctypes.POINTER(PamResponse))
        for i in range(n_msg):
            style = msg[i][0].msg_style
            if style in (PAM_PROMPT_ECHO_OFF, PAM_PROMPT_ECHO_ON):
                dup = libc.strdup(password)
                if not dup:
                    return 1
                resp[0][i].resp = ctypes.cast(dup, ctypes.c_char_p)
                resp[0][i].resp_retcode = 0
            else:
                # PAM_ERROR_MSG / PAM_TEXT_INFO — no reply string
                resp[0][i].resp = None
                resp[0][i].resp_retcode = 0
        return PAM_SUCCESS

    class PamConv(ctypes.Structure):
        _fields_ = [("conv", CONV_FUNC), ("appdata_ptr", ctypes.c_void_p)]

    handle = PamHandle()
    # Keep pam_conv / conv alive for the duration of pam_* calls
    pam_conv = PamConv(conv, None)

    pam_start = libpam.pam_start
    pam_start.restype = ctypes.c_int
    pam_start.argtypes = [
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.POINTER(PamConv),
        ctypes.POINTER(PamHandle),
    ]

    pam_authenticate = libpam.pam_authenticate
    pam_authenticate.restype = ctypes.c_int
    pam_authenticate.argtypes = [PamHandle, ctypes.c_int]

    pam_acct_mgmt = libpam.pam_acct_mgmt
    pam_acct_mgmt.restype = ctypes.c_int
    pam_acct_mgmt.argtypes = [PamHandle, ctypes.c_int]

    pam_end = libpam.pam_end
    pam_end.restype = ctypes.c_int
    pam_end.argtypes = [PamHandle, ctypes.c_int]

    # "login" is present on Debian/Raspberry Pi OS; "other" as fallback
    for service in (b"login", b"other"):
        rc = pam_start(service, username, ctypes.byref(pam_conv), ctypes.byref(handle))
        if rc == PAM_SUCCESS:
            break
    else:
        print(f"pam_start failed: {rc}", file=sys.stderr)
        return 1

    rc = pam_authenticate(handle, 0)
    if rc != PAM_SUCCESS:
        pam_end(handle, rc)
        print("authentication failed", file=sys.stderr)
        return 1

    rc = pam_acct_mgmt(handle, 0)
    pam_end(handle, rc)
    if rc != PAM_SUCCESS:
        print("account management failed", file=sys.stderr)
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
