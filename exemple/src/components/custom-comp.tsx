
import { useState } from "react";

export default function CustomComp() {
    const [count, setCount] = useState(0);
    return (
        <div>
            <h1>Custom Comp {count} ++</h1>
            <button onClick={() => setCount(count + 1)}>Increment</button>
        </div>
    );
}