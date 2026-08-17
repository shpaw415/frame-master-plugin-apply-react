import { createContext } from "react";

export const customContext = createContext({
    value: 0,
    setValue: (value: number) => {},
});