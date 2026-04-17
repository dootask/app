export type RootStackParamList = {
  Main: undefined;
  ChildWebView: {
    url: string;
    title?: string;
    titleFixed?: boolean;
    pageId: string;
  };
  Scanner: {
    scanId: string;
  };
};
