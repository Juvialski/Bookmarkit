"""Windows user/machine-bound DPAPI token storage, without PowerShell modules."""
import ctypes
import os
from pathlib import Path
import subprocess


class Blob(ctypes.Structure):
    _fields_ = [('size', ctypes.c_uint32), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def transform(value, protect):
    if os.name != 'nt': raise RuntimeError('Windows DPAPI required')
    buffer = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
    source = Blob(len(value), buffer); output = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    function = crypt.CryptProtectData if protect else crypt.CryptUnprotectData
    # UI_FORBIDDEN: no prompts, user/machine binding, no machine-wide scope.
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise RuntimeError('DPAPI operation failed')
    free = ctypes.WinDLL('kernel32').LocalFree; free.argtypes = [ctypes.c_void_p]
    try: return ctypes.string_at(output.data, output.size)
    finally: free(ctypes.cast(output.data, ctypes.c_void_p))


def save(path, token):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(transform(token.encode('ascii'), True))
    identity = os.environ['USERDOMAIN'] + '\\' + os.environ['USERNAME']
    result = subprocess.run(['icacls.exe', str(path), '/inheritance:r', '/grant:r', identity + ':(F)'], capture_output=True, timeout=15)
    if result.returncode: raise RuntimeError('Credential ACL failed')


def load(path):
    return transform(Path(path).read_bytes(), False).decode('ascii')
