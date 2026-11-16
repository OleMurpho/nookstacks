"""Every text-ish file opens as an editable document."""

def greet(name: str = "Nookstacks") -> str:
    return f"hello, {name}"

if __name__ == "__main__":
    print(greet())
