// expo-router is mocked for screen-level tests: screens only use useRouter() and <Redirect/>.
export const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    useRouter: () => require('./jest.setup').mockRouter,
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{`redirect:${href}`}</Text>,
  };
});

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
});
