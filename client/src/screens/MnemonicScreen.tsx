import { t } from "~/lib/i18n";
import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { copyToClipboard } from "../lib/clipboardUtils";
import Icon from "@react-native-vector-icons/ionicons";
import { useIconColor } from "../hooks/useTheme";
import { Text } from "../components/ui/text";
import { NoahSafeAreaView } from "~/components/NoahSafeAreaView";
import { NoahActivityIndicator } from "../components/ui/NoahActivityIndicator";
import { useAlert } from "~/contexts/AlertProvider";
import { useBiometrics } from "../hooks/useBiometrics";

import type { OnboardingStackParamList, SettingsStackParamList } from "../Navigators";
import { Card, CardContent } from "../components/ui/card";
import { getMnemonic } from "~/lib/crypto";
import { NativeNoahButton } from "~/components/ui/NativeNoahButton";
import { NativeNoahSecondaryButton } from "~/components/ui/NativeNoahSecondaryButton";

type MnemonicScreenRouteProp = RouteProp<
  OnboardingStackParamList & SettingsStackParamList,
  "Mnemonic"
>;

const MnemonicScreen = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<OnboardingStackParamList & SettingsStackParamList>>();
  const route = useRoute<MnemonicScreenRouteProp>();
  const iconColor = useIconColor();
  const { fromOnboarding } = route.params || {};

  const [mnemonic, setMnemonic] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { showAlert } = useAlert();
  const { authenticateIfEnabled } = useBiometrics();

  useEffect(() => {
    const authenticate = async () => {
      if (!fromOnboarding) {
        const result = await authenticateIfEnabled(t("mn.authToView"));
        if (result.isErr()) {
          showAlert({
            title: t("mn.authFailed"),
            description: t("mn.mustAuth"),
          });
          navigation.goBack();
          return;
        }
      }

      setIsAuthenticated(true);
    };
    authenticate();
  }, [showAlert, navigation, fromOnboarding, authenticateIfEnabled]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchMnemonic = async () => {
      const mnemonicResult = await getMnemonic();
      if (mnemonicResult.isOk()) {
        setMnemonic(mnemonicResult.value);
      } else {
        showAlert({
          title: "Error",
          description: t("mn.retrieveFailed"),
        });
        navigation.goBack();
      }
    };
    fetchMnemonic();
  }, [isAuthenticated, showAlert, navigation]);

  const handleCopy = async () => {
    await copyToClipboard(mnemonic, {
      onCopy: () => {
        showAlert({ title: t("mn.copied"), description: t("mn.phraseCopied") });
      },
    });
  };

  const handleContinue = () => {
    if (fromOnboarding) {
      navigation.navigate("EmailVerification");
    } else {
      navigation.goBack();
    }
  };

  return (
    <NoahSafeAreaView className="flex-1 bg-background p-4">
      <View className="p-4">
        <View className="flex-row items-center mb-8">
          {!fromOnboarding && (
            <Pressable onPress={() => navigation.goBack()} className="mr-4">
              <Icon name="arrow-back-outline" size={24} color={iconColor} />
            </Pressable>
          )}
          <Text className="text-2xl font-bold text-foreground" numberOfLines={1} adjustsFontSizeToFit>{t("mn.title")}</Text>
        </View>

        <Text className="text-lg text-muted-foreground mb-6">
          {t("mn.instruction")}
        </Text>

        {!isAuthenticated ? (
          <View className="flex-1 justify-center items-center">
            <NoahActivityIndicator size="large" />
            <Text className="text-muted-foreground mt-4">{t("mn.authenticating")}</Text>
          </View>
        ) : mnemonic ? (
          <Card>
            <CardContent className="p-4">
              <Text className="text-xl text-center text-foreground tracking-widest leading-loose">
                {mnemonic}
              </Text>
            </CardContent>
          </Card>
        ) : (
          <View className="flex-1 justify-center items-center">
            <NoahActivityIndicator size="large" />
          </View>
        )}

        {mnemonic && (
          <View className="mt-6">
            <NativeNoahSecondaryButton label={t("mn.copyPhrase")} onPress={handleCopy} fullWidth />
          </View>
        )}

        <NativeNoahButton
          label={fromOnboarding ? "I Have Saved It, Continue" : t("mn.done")}
          onPress={handleContinue}
          disabled={!mnemonic}
          className="mt-4"
          fullWidth
        />
      </View>
    </NoahSafeAreaView>
  );
};

export default MnemonicScreen;
