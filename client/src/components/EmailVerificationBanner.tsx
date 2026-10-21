import { t } from "~/lib/i18n";
import React from "react";
import { View, Pressable } from "react-native";
import { ChevronRight, Mail, X } from "lucide-react-native";
import { Text } from "./ui/text";
import { useIconColor } from "~/hooks/useTheme";
import { COLORS } from "~/lib/styleConstants";

interface EmailVerificationBannerProps {
  onPress: () => void;
  onDismiss: () => void;
}

export const EmailVerificationBanner: React.FC<EmailVerificationBannerProps> = ({
  onPress,
  onDismiss,
}) => {
  const iconColor = useIconColor();

  return (
    <View className="mx-4 mt-4 mb-2 bg-card border border-border rounded-xl">
      <Pressable onPress={onPress} className="p-4 pr-12">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center gap-2">
            <Mail size={20} color={COLORS.BITCOIN_ORANGE} />
            <Text className="text-base font-semibold" style={{ color: COLORS.BITCOIN_ORANGE }}>
              {t("ui.020")}
            </Text>
          </View>
          <ChevronRight size={20} color={iconColor} />
        </View>

        <Text className="text-sm text-muted-foreground">
          {t("ui.021")}
        </Text>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        accessibilityLabel={t("ui.022")}
        className="absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full"
      >
        <X size={18} color={iconColor} />
      </Pressable>
    </View>
  );
};
