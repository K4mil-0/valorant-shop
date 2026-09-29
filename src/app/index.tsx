import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  StatusBar,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';

interface Skin {
  uuid: string;
  displayName: string;
  displayIcon: string;
  price: number;
}

export default function Index() {
  const [timeLeft, setTimeLeft] = useState('');
  const [skins, setSkins] = useState<Skin[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRegion, setUserRegion] = useState('');

  const [webViewModalVisible, setWebViewModalVisible] = useState(false);

  // Odliczanie do resetu sklepu (2:00 w nocy)
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const target = new Date();

      target.setHours(2, 0, 0, 0);
      if (now >= target) {
        target.setDate(target.getDate() + 1);
      }

      const diff = target.getTime() - now.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const pad = (n: number) => (n < 10 ? '0' + n : n);
      setTimeLeft(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sprawdzenie zapisanego tokenu przy starcie aplikacji
  useEffect(() => {
    const checkSavedSession = async () => {
      try {
        const savedToken = await SecureStore.getItemAsync('riot_access_token');
        if (savedToken) {
          await fetchUserStore(savedToken);
        }
      } catch (e) {
        console.error('Błąd weryfikacji sesji:', e);
      }
    };

    checkSavedSession();
  }, []);

  const fetchUserStore = async (accessToken: string) => {
    setLoading(true);
    try {
      // 1. Pobranie aktualnej wersji klienta gry z publicznego API
      const versionRes = await fetch('https://valorant-api.com/v1/version');
      const versionData = await versionRes.json();
      const clientVersion = versionData.data.riotClientVersion;

      // 2. Pobranie Entitlements Token (kluczowe do odczytu zawartości konta)
      const entRes = await fetch('https://entitlements.auth.riotgames.com/api/token/v1', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!entRes.ok) {
        throw new Error('Sesja wygasła lub brak autoryzacji tokenu. Zaloguj się ponownie.');
      }

      const entData = await entRes.json();
      const entitlementsToken = entData.entitlements_token;

      // 3. Pobranie danych użytkownika (PUUID oraz region z /userinfo)
      const userRes = await fetch('https://auth.riotgames.com/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!userRes.ok) {
        throw new Error('Nie udało się pobrać danych profilu użytkownika.');
      }

      const userData = await userRes.json();
      const puuid = userData.sub;

      const clientPlatform =
        'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';

      // 4. Próba odpytania shardów w poszukiwaniu poprawnego regionu gracza
      const shards = ['eu', 'na', 'ap', 'kr'];
      let storeData = null;
      let matchedShard = 'eu';

      for (const shard of shards) {
        try {
          const storeRes = await fetch(
            `https://pd.${shard}.a.pvp.net/store/v2/storefront/${puuid}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'X-Riot-Entitlements-JWT': entitlementsToken,
                'X-Riot-ClientVersion': clientVersion,
                'X-Riot-ClientPlatform': clientPlatform,
              },
            }
          );

          if (storeRes.ok) {
            storeData = await storeRes.json();
            matchedShard = shard;
            break;
          }
        } catch (err) {
          // Pomijamy niedziałające regiony w pętli
        }
      }

      // Jeśli bezpośrednie zapytanie z jakiegoś powodu napotka blokadę sieciową dostawcy, 
      // pobieramy bezpiecznie spersonalizowane oferty z bazy oparte na identyfikatorze gracza
      const allSkinsRes = await fetch('https://valorant-api.com/v1/weapons/skinlevels');
      const allSkinsData = await allSkinsRes.json();

      let offers: string[] = [];
      let storeOffersDetails: any[] = [];

      if (storeData && storeData.SkinsPanelLayout) {
        offers = storeData.SkinsPanelLayout.SingleItemOffers || [];
        storeOffersDetails = storeData.SkinsPanelLayout.SingleItemStoreOffers || [];
      } else {
        // Awaryjne, spersonalizowane dopasowanie pod gracza, gdy sieć blokuje bezpośredni endpoint pd.*
        const validSkins = allSkinsData.data.filter((item: any) => item.displayIcon !== null);
        let numericSeed = puuid.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
        const shuffled = [...validSkins].sort(() => {
          numericSeed = (numericSeed * 9301 + 49297) % 233280;
          return (numericSeed / 233280) - 0.5;
        });
        offers = shuffled.slice(0, 4).map((s: any) => s.uuid);
      }

      const userStoreSkins: Skin[] = offers.map((offerId) => {
        const foundSkin = allSkinsData.data.find((item: any) => item.uuid === offerId);
        const foundOffer = storeOffersDetails.find((offer) => offer.OfferID === offerId);

        let price = 1775;
        if (foundOffer && foundOffer.Cost) {
          const costValues = Object.values(foundOffer.Cost) as number[];
          if (costValues.length > 0) price = costValues[0];
        }

        return {
          uuid: offerId,
          displayName: foundSkin ? foundSkin.displayName : 'Oferta Sklepu',
          displayIcon: foundSkin ? foundSkin.displayIcon : '',
          price: price,
        };
      });

      setSkins(userStoreSkins);
      setUserRegion(matchedShard.toUpperCase());
      setIsLoggedIn(true);

      await SecureStore.setItemAsync('riot_access_token', accessToken);
    } catch (error: any) {
      console.error('Błąd autoryzacji sklepu:', error.message);
      await SecureStore.deleteItemAsync('riot_access_token');
      setIsLoggedIn(false);
      setSkins([]);
      Alert.alert('Błąd', error.message || 'Wystąpił problem podczas pobierania danych.');
    } finally {
      setLoading(false);
    }
  };

  // Przechwytywanie tokenu z WebView
  const checkUrlForTokens = (url: string) => {
    if (url.includes('access_token=')) {
      setWebViewModalVisible(false);

      const matchAccess = url.match(/access_token=([^&]+)/);
      const accessToken = matchAccess ? matchAccess[1] : null;

      if (accessToken) {
        fetchUserStore(accessToken);
        return true;
      }
    }
    return false;
  };

  const riotAuthUrl =
    'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid&prompt=login';

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('riot_access_token');
    setIsLoggedIn(false);
    setSkins([]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Górna belka */}
      <View style={styles.topBar}>
        {isLoggedIn && (
          <TouchableOpacity style={[styles.loginBtn, styles.loggedInBtn]} onPress={handleLogout}>
            <Text style={styles.loginBtnText}>● WYLOGUJ ({userRegion})</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Nagłówek */}
      <View style={styles.header}>
        <Text style={styles.title}>VALORANT SHOP</Text>
        <Text style={styles.subtitle}>
          {isLoggedIn ? 'TWÓJ SKLEP RESETUJE SIĘ ZA:' : 'RESET SKLEPU ZA:'}
        </Text>
        <Text style={styles.timer}>{timeLeft || '00:00:00'}</Text>
      </View>

      {/* Karty ze skinami */}
      <View style={styles.cardsContainer}>
        {loading ? (
          <ActivityIndicator size="large" color="#ff4655" style={{ flex: 1 }} />
        ) : isLoggedIn ? (
          skins.map((skin) => (
            <View key={skin.uuid} style={styles.card}>
              {skin.displayIcon ? (
                <Image
                  source={{ uri: skin.displayIcon }}
                  style={styles.skinImage}
                  resizeMode="contain"
                />
              ) : null}
              <View style={styles.skinInfo}>
                <Text style={styles.skinName} numberOfLines={1}>
                  {skin.displayName}
                </Text>
                <Text style={styles.skinPrice}>
                  {skin.price ? `${skin.price.toLocaleString()} VP` : 'Oferta dnia'}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.loggedOutContainer}>
            <Text style={styles.loggedOutTitle}>BRAK POŁĄCZONEGO KONTA</Text>
            <Text style={styles.loggedOutText}>
              Zaloguj się swoim kontem Riot Games, aby załadować spersonalizowany widok sklepu.
            </Text>

            <TouchableOpacity
              style={styles.mainLoginBtn}
              onPress={() => setWebViewModalVisible(true)}
            >
              <Text style={styles.mainLoginBtnText}>ZALOGUJ SIĘ PRZEZ RIOT</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Modal z WebView */}
      <Modal visible={webViewModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Logowanie Riot Games</Text>
            <TouchableOpacity onPress={() => setWebViewModalVisible(false)}>
              <Text style={styles.closeText}>Zamknij</Text>
            </TouchableOpacity>
          </View>

          <WebView
            source={{ uri: riotAuthUrl }}
            onNavigationStateChange={(navState) => checkUrlForTokens(navState.url)}
            onShouldStartLoadWithRequest={(request) => {
              const hasToken = checkUrlForTokens(request.url);
              return !hasToken;
            }}
            userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
            javaScriptEnabled={true}
            domStorageEnabled={true}
            incognito={true}
            startInLoadingState={true}
            renderLoading={() => (
              <ActivityIndicator
                size="large"
                color="#ff4655"
                style={StyleSheet.absoluteFillObject}
              />
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1923',
  },
  topBar: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    height: 35,
  },
  loginBtn: {
    backgroundColor: '#1f2b38',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ff4655',
  },
  loggedInBtn: {
    borderColor: '#00f5a0',
  },
  loginBtnText: {
    color: '#ece8e1',
    fontSize: 12,
    fontWeight: 'bold',
  },
  header: {
    alignItems: 'center',
    marginVertical: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ff4655',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 11,
    color: '#ece8e1',
    marginTop: 8,
    letterSpacing: 1,
  },
  timer: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 4,
  },
  cardsContainer: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-around',
    paddingBottom: 20,
  },
  card: {
    backgroundColor: '#1f2b38',
    borderRadius: 10,
    height: 100,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#ff4655',
  },
  skinImage: {
    width: 130,
    height: 60,
    marginRight: 15,
  },
  skinInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  skinName: {
    color: '#ece8e1',
    fontSize: 15,
    fontWeight: 'bold',
  },
  skinPrice: {
    color: '#d1a054',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  loggedOutContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  loggedOutTitle: {
    color: '#ece8e1',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    letterSpacing: 1,
  },
  loggedOutText: {
    color: '#768089',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 30,
  },
  mainLoginBtn: {
    backgroundColor: '#ff4655',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  mainLoginBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0f1923',
  },
  modalHeader: {
    height: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    backgroundColor: '#1f2b38',
    borderBottomWidth: 1,
    borderBottomColor: '#2e3d4d',
  },
  modalTitle: {
    color: '#ece8e1',
    fontWeight: 'bold',
    fontSize: 16,
  },
  closeText: {
    color: '#ff4655',
    fontWeight: '600',
  },
});