import { t } from "~/lib/i18n";
import React, { useEffect } from "react";
import { View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { OnboardingStackParamList } from "../Navigators";
import { Text } from "../components/ui/text";
import { NoahActivityIndicator } from "../components/ui/NoahActivityIndicator";
import { NoahSafeAreaView } from "~/components/NoahSafeAreaView";
import { useCreateWallet } from "../hooks/useWallet";
import { NativeNoahButton } from "~/components/ui/NativeNoahButton";
import { NativeNoahSecondaryButton } from "~/components/ui/NativeNoahSecondaryButton";

const BetaWarningScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const { mutate: createWallet, isPending, isSuccess } = useCreateWallet();

  useEffect(() => {
    if (isSuccess) {
      navigation.navigate("Mnemonic", { fromOnboarding: true });
    }
  }, [isSuccess, navigation]);

  const handleDecline = () => {
    navigation.goBack();
  };

  return (
    <NoahSafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center px-6 py-10">
        <View className="items-center">
          <View className="h-20 w-20 items-center justify-center rounded-3xl border border-border bg-card">
            <AlertTriangle size={40} color="#f97316" />
          </View>
          <Text className="mt-6 text-center text-3xl font-bold text-foreground">
            {t("beta.title")}
          </Text>
          <Text className="mt-4 text-center text-lg leading-7 text-muted-foreground">
            {t("beta.warning")}
          </Text>
        </View>

        <View className="mt-10">
          {isPending ? (
            <View className="items-center">
              <NoahActivityIndicator size="large" />
              <Text className="mt-4 text-muted-foreground">{t("beta.creating")}</Text>
            </View>
          ) : (
            <View className="space-y-3">
              <NativeNoahButton
                label={t("beta.accept")}
                onPress={() => createWallet()}
                size="lg"
                fullWidth
              />
              <View className="mt-3">
                <NativeNoahSecondaryButton
                  label={t("beta.refuse")}
                  onPress={handleDecline}
                  size="lg"
                  fullWidth
                />
              </View>
            </View>
          )}
        </View>
      </View>
    </NoahSafeAreaView>
  );
};

export default BetaWarningScreen;
