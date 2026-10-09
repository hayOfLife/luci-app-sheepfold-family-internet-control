// Проверяет URL/версию/подпись на чистой модели без сети и изменения Android
// Успех не доказывает TLS, установку APK и сохранность данных на физическом телефоне
package app.sheepfold.android.updates

import org.junit.Assert.*
import org.junit.Test

class ParentUpdatePolicyTest {
    private val prefix = "https://github.com/${ParentUpdatePolicy.repository}/releases/download/v2/"
    private val name = "sheepfold-parent-v0.2.0.apk"
    private val digest = "sha256:" + "a".repeat(64)
    private val release = ParentUpdatePolicy.release(name, prefix + name, 100, digest)!!
    private val installed = AppIdentity("app.sheepfold.android", 57, "0.1.56", setOf("signature"))
    private val archive = installed.copy(versionCode = 58, versionName = "0.2.0")

    @Test fun renamedRepositoryIsTheOnlyReleaseSource() {
        assertEquals("hayOfLife/luci-app-sheepfold-family-internet-control", ParentUpdatePolicy.repository)
        assertNotNull(ParentUpdatePolicy.release(name,
            "https://github.com/hayOfLife/luci-app-sheepfold-family-internet-control/releases/download/v2/$name", 100, digest))
        assertNull(ParentUpdatePolicy.release(name,
            "https://github.com/kva4991/luci-app-sheepfold-family-internet-control/releases/download/v2/$name", 100, digest))
    }

    @Test fun versionsAreNumericAndRejectAmbiguousFormats() {
        assertEquals(1, ParentUpdatePolicy.compareVersions("0.1.10", "0.1.9"))
        assertEquals(0, ParentUpdatePolicy.compareVersions("1.0", "1.0.0"))
        for (version in listOf("1", "1.0-beta", "1.01", "999999999.1", "../2", "1.0.0.0.0"))
            assertNull(version, ParentUpdatePolicy.versionParts(version))
    }

    @Test fun onlyExactParentAssetsWithDigestAndBoundedSizeAreAccepted() {
        assertNotNull(release)
        for (bad in listOf("sheepfold-child-v0.2.0.apk", "sheepfold-parent-v0.2.0.apk.exe", "luci-app-sheepfold.apk"))
            assertNull(ParentUpdatePolicy.release(bad, prefix + bad, 100, digest))
        for (size in listOf(0L, -1L, ParentUpdatePolicy.maxApkBytes + 1))
            assertNull(ParentUpdatePolicy.release(name, prefix + name, size, digest))
        for (hash in listOf("", "md5:" + "a".repeat(32), "sha256:" + "z".repeat(64)))
            assertNull(ParentUpdatePolicy.release(name, prefix + name, 100, hash))
    }

    @Test fun downloadRedirectsAreHttpsAndAllowlisted() {
        assertTrue(ParentUpdatePolicy.allowedDownloadUrl(prefix + name))
        assertTrue(ParentUpdatePolicy.allowedDownloadUrl("https://release-assets.githubusercontent.com/a?sig=fixture"))
        assertTrue(ParentUpdatePolicy.allowedDownloadUrl("https://objects.githubusercontent.com/a"))
        for (url in listOf(
            "http://github.com/a", "https://github.com.evil.invalid/a", "https://127.0.0.1/a",
            "https://user@release-assets.githubusercontent.com/a", "https://release-assets.githubusercontent.com:444/a",
            "https://release-assets.githubusercontent.com/a#fragment", "https://github.com/other/project/releases/download/a.apk",
            prefix + "../" + name, prefix + "%2e%2e/" + name
        )) assertFalse(url, ParentUpdatePolicy.allowedDownloadUrl(url))
    }

    @Test fun metadataCannotStartAtCdnOrUseAnotherFilename() {
        assertNull(ParentUpdatePolicy.release(name, "https://objects.githubusercontent.com/$name", 100, digest))
        assertNull(ParentUpdatePolicy.release(name, prefix + name + "?redirect=1", 100, digest))
        assertNull(ParentUpdatePolicy.release(name, prefix + "other.apk", 100, digest))
    }

    @Test fun onlyNewerSamePackageSameSignerArchiveIsAccepted() {
        assertTrue(ParentUpdatePolicy.acceptsArchive(installed, archive, release))
        for (bad in listOf(
            archive.copy(packageName = "app.sheepfold.child"),
            archive.copy(versionCode = installed.versionCode),
            archive.copy(versionCode = 1),
            archive.copy(versionName = "9.0"),
            archive.copy(signers = emptySet()),
            archive.copy(signers = setOf("attacker")),
            archive.copy(signers = setOf("signature", "attacker"))
        )) assertFalse(ParentUpdatePolicy.acceptsArchive(installed, bad, release))
        assertFalse(ParentUpdatePolicy.acceptsArchive(installed.copy(signers = emptySet()), archive, release))
    }
}
