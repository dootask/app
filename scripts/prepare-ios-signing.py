#!/usr/bin/env python3
"""校验 profiles（内测 ad-hoc / development，或上架 app-store）、安装到构建机并生成导出配置；不改动原生工程。"""

import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys


def prepare(directory):
    method = os.environ.get("IOS_EXPORT_METHOD", "ad-hoc")
    export_methods = {"ad-hoc": "release-testing", "development": "debugging", "app-store": "app-store-connect"}
    if method not in export_methods:
        raise ValueError("IOS_EXPORT_METHOD 仅支持 ad-hoc / development / app-store")

    directory.mkdir(parents=True, exist_ok=True)
    profiles = {}
    team = None
    certificate_hashes = None
    for bundle_id, secret in {
        "com.dootask.task": "IOS_PROVISION_PROFILE_BASE64",
        "com.dootask.task.shareExtension": "IOS_SHARE_EXTENSION_PROVISION_PROFILE_BASE64",
    }.items():
        profile_path = directory / f"{bundle_id}.mobileprovision"
        profile_path.write_bytes(base64.b64decode(os.environ[secret]))
        decoded = subprocess.check_output(["security", "cms", "-D", "-i", str(profile_path)])
        profile = plistlib.loads(decoded)
        entitlements = profile["Entitlements"]
        profile_team = profile["TeamIdentifier"][0]
        team = team or profile_team
        if profile_team != team:
            raise ValueError("主 App 与分享扩展 profiles 必须属于同一 Apple Team")
        prefix = profile["ApplicationIdentifierPrefix"][0]
        if entitlements.get("application-identifier") != f"{prefix}.{bundle_id}":
            raise ValueError(f"profile 与 Bundle ID 不匹配：{bundle_id}")
        if entitlements.get("com.apple.developer.team-identifier") != team:
            raise ValueError(f"profile 的 Team entitlement 不匹配：{bundle_id}")
        if "group.im.dootask" not in entitlements.get("com.apple.security.application-groups", []):
            raise ValueError(f"profile 缺少 App Group group.im.dootask：{bundle_id}")
        if method == "app-store":
            if profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices"):
                raise ValueError(f"上架需要 App Store profile，不能使用内测 profile：{bundle_id}")
        elif not profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices"):
            raise ValueError(f"需要包含测试设备 UDID 的 {method} profile，不能使用 App Store profile：{bundle_id}")
        # 主 App 由 DooPush 收远程推送（aps-environment=production）
        if bundle_id == "com.dootask.task" and "aps-environment" not in entitlements:
            raise ValueError(f"profile 缺少 Push Notifications：{bundle_id}")
        if bool(entitlements.get("get-task-allow")) != (method == "development"):
            raise ValueError(f"profile 类型与 {method} 导出方式不匹配：{bundle_id}")
        expiry = profile["ExpirationDate"].replace(tzinfo=datetime.timezone.utc)
        if expiry <= datetime.datetime.now(datetime.timezone.utc):
            raise ValueError(f"profile 已过期：{bundle_id}")
        hashes = {hashlib.sha1(cert).hexdigest().upper() for cert in profile["DeveloperCertificates"]}
        certificate_hashes = hashes if certificate_hashes is None else certificate_hashes & hashes
        profiles[bundle_id] = {"uuid": profile["UUID"], "path": str(profile_path)}

    # 只选择同时被两个 profile 允许且在临时钥匙串中具有私钥的有效签名身份。
    identities = subprocess.check_output(
        ["security", "find-identity", "-v", "-p", "codesigning", str(directory / "signing.keychain-db")],
        text=True,
    )
    valid_hashes = set(re.findall(r"\b[0-9A-F]{40}\b", identities))
    matching_hashes = sorted(certificate_hashes & valid_hashes)
    if not matching_hashes:
        raise ValueError("导入的证书/私钥与两个 profiles 没有共同的有效签名身份")
    identity = matching_hashes[0]

    installed = []
    for profile in profiles.values():
        # 同时兼容新旧 Xcode 的 provisioning profile 搜索目录。
        for relative in ["Library/MobileDevice/Provisioning Profiles", "Library/Developer/Xcode/UserData/Provisioning Profiles"]:
            destination = Path.home() / relative / f"{profile['uuid']}.mobileprovision"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(profile["path"], destination)
            installed.append(str(destination))

    export_options = {
        "method": export_methods[method],
        "destination": "export",
        "signingStyle": "manual",
        "teamID": team,
        "signingCertificate": identity,
        "provisioningProfiles": {bundle: profile["uuid"] for bundle, profile in profiles.items()},
        "manageAppVersionAndBuildNumber": False,
    }
    (directory / "ExportOptions.plist").write_bytes(plistlib.dumps(export_options))
    (directory / "signing.json").write_text(json.dumps({
        "team": team, "identity": identity, "profiles": profiles, "installed_profiles": installed,
    }), encoding="utf-8")
    print(f"已校验并安装主 App / 分享扩展 {method} profiles（含 group.im.dootask、推送）")


if __name__ == "__main__":
    try:
        prepare(Path(sys.argv[1]).resolve())
    except (KeyError, ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"iOS 内测签名配置失败：{error}")
