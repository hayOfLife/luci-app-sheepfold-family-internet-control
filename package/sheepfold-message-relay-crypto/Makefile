include $(TOPDIR)/rules.mk

PKG_NAME:=sheepfold-message-relay-crypto
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=hayOfLife
PKG_ASLR_PIE_REGULAR:=1

include $(INCLUDE_DIR)/package.mk

define Package/sheepfold-message-relay-crypto
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Sheepfold family message relay cryptographic helper
  DEPENDS:=+jansson +libopenssl
  USERID:=sheepfold-relay:sheepfold-relay
endef

define Package/sheepfold-message-relay-crypto/description
 Native strict-SFMR1 and AES-256-GCM helper used by the optional Sheepfold
 family message relay. It contains no enrollment credentials or content keys.
endef

define Build/Prepare
	$(call Build/Prepare/Default)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) -std=c11 -Wall -Wextra \
		-Werror -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=2 -fstack-protector-strong \
		-o $(PKG_BUILD_DIR)/sheepfold-message-relay-crypto \
		$(PKG_BUILD_DIR)/sheepfold-message-relay-crypto.c \
		$(PKG_BUILD_DIR)/relayJson.c \
		$(TARGET_LDFLAGS) -Wl,-z,now -Wl,-z,relro -lcrypto -ljansson -lm
endef

define Package/sheepfold-message-relay-crypto/install
	$(INSTALL_DIR) $(1)/usr/libexec/sheepfold
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/sheepfold-message-relay-crypto \
		$(1)/usr/libexec/sheepfold/sheepfold-message-relay-crypto
endef

define Package/sheepfold-message-relay-crypto/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
uid="$$(id -u sheepfold-relay 2>/dev/null || true)"
gid="$$(id -g sheepfold-relay 2>/dev/null || true)"
case "$$uid:$$gid" in
	''|:|0:*|*:0) exit 1 ;;
esac
exit 0
endef

$(eval $(call BuildPackage,sheepfold-message-relay-crypto))
