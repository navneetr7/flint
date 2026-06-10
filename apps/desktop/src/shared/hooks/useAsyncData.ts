import { useEffect, useState } from "react";

type AsyncState<TData> = {
  data: TData | null;
  error: string | null;
  isLoading: boolean;
};

export function useAsyncData<TData>(loader: () => Promise<TData>, dependencies: unknown[] = []) {
  const [state, setState] = useState<AsyncState<TData>>({
    data: null,
    error: null,
    isLoading: true,
  });

  useEffect(() => {
    let isMounted = true;

    setState((current) => ({
      ...current,
      isLoading: current.data === null,
      error: null,
    }));
    loader()
      .then((data) => {
        if (isMounted) {
          setState({ data, error: null, isLoading: false });
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setState({
            data: null,
            error: error instanceof Error ? error.message : "Something went wrong",
            isLoading: false,
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, dependencies);

  return state;
}
