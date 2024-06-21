export function cancellablePromise(promise: Promise<any>): Promise<any> {
  let rejectFn: (reason: any) => void;
  const newPromise: Promise<any> = new Promise((res, rej) => {
    rejectFn = rej;
    promise
      .then(res)
      .catch(rej);
  });
  newPromise['cancel'] = () => {
    rejectFn("the promise got cancelled");
  };
  return newPromise;
};
